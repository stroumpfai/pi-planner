import { vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AbsenceDialog, describeDraft } from '../AbsenceDialog'
import * as apiModule from '@/services/api'
import type { Absence, TeamMember } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock; patch: Mock; delete: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const member = (id: string, name: string): TeamMember =>
  ({ system_id: id, team_id: 't-1', name, role: null, organisation: null }) as TeamMember

const MEMBERS = [
  member('m-1', 'Marta Lindqvist'),
  member('m-2', 'Tomas Bergerat'),
  member('m-3', 'Aïcha Ben Salah'),
]

const WINDOW = { from: '2026-09-01', to: '2027-08-31' }

const renderDialog = (props: Partial<React.ComponentProps<typeof AbsenceDialog>> = {}) =>
  render(
    <AbsenceDialog
      open
      teamId="t-1"
      members={MEMBERS}
      window={WINDOW}
      onClose={props.onClose ?? vi.fn()}
      {...props}
    />,
    { wrapper: wrapper() },
  )

const lastPost = () => mockApi.post.mock.calls[mockApi.post.mock.calls.length - 1]

describe('AbsenceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.post.mockResolvedValue({ data: [] })
    mockApi.patch.mockResolvedValue({ data: {} })
  })

  it('selects the whole team in one click — the public-holiday flow', async () => {
    const user = userEvent.setup()
    renderDialog({
      draft: { memberIds: [], from: '2026-12-25', to: '2026-12-25', startHalf: 'am', endHalf: 'pm' },
    })

    await user.click(screen.getByRole('button', { name: 'all 3' }))
    expect(screen.getByLabelText('Marta Lindqvist')).toBeChecked()
    expect(screen.getByLabelText('Aïcha Ben Salah')).toBeChecked()
    expect(screen.getByText(/3 people/)).toBeInTheDocument()
  })

  it('writes one record per member from one form', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog({
      draft: { memberIds: ['m-1', 'm-2'], from: '2026-12-25', to: '2026-12-25', startHalf: 'am', endHalf: 'pm' },
      onClose,
    })

    await user.type(screen.getByLabelText(/^Label/), 'Christmas')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const [url, body, config] = lastPost()
    expect(url).toBe('/teams/t-1/absences')
    expect(body.member_ids).toEqual(['m-1', 'm-2'])
    expect(body.kind).toBe('range')
    expect(body.label).toBe('Christmas')
    // The saved row comes back expanded for the window the grid is showing.
    expect(config.params).toEqual(WINDOW)
    expect(onClose).toHaveBeenCalled()
  })

  it('pre-fills from a drag rather than writing it', async () => {
    renderDialog({
      draft: { memberIds: ['m-3'], from: '2026-09-14', to: '2026-09-16', startHalf: 'pm', endHalf: 'am' },
    })
    expect(mockApi.post).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Aïcha Ben Salah')).toBeChecked()
    expect(screen.getByText(/2026-09-14 – 2026-09-16, pm to am/)).toBeInTheDocument()
  })

  it('offers three kinds, so the weekly case has nothing extra to fill in', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Weekly' }))
    expect(screen.getByLabelText('Weekday')).toBeInTheDocument()
    // No interval field on the common path (§3.4).
    expect(screen.queryByLabelText(/^Every/)).not.toBeInTheDocument()
  })

  it('calls the interval anchor a first occurrence and previews the dates', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Interval' }))
    const anchor = screen.getByLabelText(/First occurrence/)
    await user.type(anchor, '04.09.2026')
    await user.selectOptions(screen.getByLabelText('Weekday'), '4')

    // Chips are the check against an off-by-one week (§3.4).
    expect(await screen.findByText('2026-09-04')).toBeInTheDocument()
    expect(screen.getByText('2026-09-18')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Runs from/)).not.toBeInTheDocument()
  })

  it('sends a recurring rule with only that kind’s fields', async () => {
    const user = userEvent.setup()
    renderDialog({ draft: { memberIds: ['m-1'], from: '2026-03-04', to: '2026-03-04', startHalf: 'am', endHalf: 'pm' } })

    await user.click(screen.getByRole('tab', { name: 'Weekly' }))
    await user.selectOptions(screen.getByLabelText('Weekday'), '2')
    await user.selectOptions(screen.getByLabelText('Halves'), 'pm')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const body = lastPost()[1]
    expect(body).toMatchObject({ kind: 'weekly', weekday: 2, halves: ['pm'], interval_weeks: null })
  })

  it('warns once about a date ten years out, then lets it through', async () => {
    const user = userEvent.setup()
    const far = `${new Date().getFullYear() + 12}`
    renderDialog({
      draft: {
        memberIds: ['m-1'],
        from: `${far}-06-01`,
        to: `${far}-06-01`,
        startHalf: 'am',
        endHalf: 'pm',
      },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/check the year/i)
    expect(mockApi.post).not.toHaveBeenCalled()

    // A sanity check, not a horizon — the second press saves it (§7.4).
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
  })

  it('refuses to save with nobody chosen', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one person/i)
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('locks the member when editing, because moving one is a delete and a create', async () => {
    const editing = {
      system_id: 'ab-1',
      team_id: 't-1',
      member_id: 'm-2',
      label: 'Free Friday',
      kind: 'interval',
      start_date: '2026-09-04',
      end_date: null,
      start_half: 'am',
      end_half: 'pm',
      weekday: 4,
      halves: ['am'],
      interval_weeks: 2,
      summary: 'every 2nd Friday am, from 2026-09-04, ongoing',
      occurrences: [],
      created_at: '2026-01-01T00:00:00Z',
      modified_at: '2026-01-01T00:00:00Z',
      etag: '"tag"',
    } as Absence
    const user = userEvent.setup()
    renderDialog({ editing })

    expect(screen.getByLabelText('Tomas Bergerat')).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Interval', selected: true })).toBeInTheDocument()
    // No "this occurrence / the whole series" anywhere — there is only the series.
    expect(screen.queryByText(/this occurrence/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    const [url, , config] = mockApi.patch.mock.calls[0]
    expect(url).toBe('/teams/t-1/absences/ab-1')
    expect(config.headers).toEqual({ 'If-Match': '"tag"' })
  })
})

describe('describeDraft', () => {
  const base = {
    kind: 'range' as const,
    startDate: '2026-12-25',
    endDate: '',
    startHalf: 'am' as const,
    endHalf: 'pm' as const,
    weekday: 4,
    halves: 'both' as const,
    intervalWeeks: 2,
    memberCount: 6,
  }

  it('says what a one-day holiday costs, not only when it is', () => {
    expect(describeDraft(base)).toBe('2026-12-25, both halves, 6 people')
  })

  it('names a single half-day as such', () => {
    expect(describeDraft({ ...base, endHalf: 'am', memberCount: 1 })).toBe(
      '2026-12-25, am only, 1 person',
    )
  })

  it('says a recurrence is ongoing when it has no end', () => {
    expect(describeDraft({ ...base, kind: 'interval' })).toContain('ongoing')
    expect(describeDraft({ ...base, kind: 'interval' })).toContain('every 2 weeks on Fri')
  })

  it('asks for a date before it will guess at a cost', () => {
    expect(describeDraft({ ...base, startDate: '' })).toMatch(/pick a date/)
  })
})
