import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { AbsenceIcsImportDialog } from '../AbsenceIcsImportDialog'
import * as apiModule from '@/services/api'
import type { Absence, AbsenceIcsImportResult, AbsenceImportCandidate } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { post: Mock }

const MEMBERS = [
  { system_id: 'm-anna', name: 'Anna Keller' },
  { system_id: 'm-ben', name: 'Ben Ott' },
]

const rule = { kind: 'range' as const, start_date: '2026-11-02', end_date: '2026-11-06', start_half: 'am' as const, end_half: 'pm' as const }

const candidate = (over: Partial<AbsenceImportCandidate> = {}): AbsenceImportCandidate => ({
  source_uid: 'week@x',
  title: 'Vacation',
  rule,
  rule_summary: '2026-11-02 – 2026-11-06, from am to pm',
  member_id: 'm-anna',
  match: 'picked',
  selected_by_default: true,
  hint: null,
  action: 'create',
  previous: null,
  ...over,
})

const stored = (over: Partial<Absence> = {}): Absence =>
  ({
    system_id: 'old-row',
    team_id: 't-1',
    member_id: 'm-anna',
    label: 'Doctor',
    kind: 'range',
    start_date: '2026-11-04',
    end_date: '2026-11-04',
    start_half: 'am',
    end_half: 'pm',
    summary: '2026-11-04, both halves',
    source_uid: 'dr@x',
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"e"',
    ...over,
  }) as Absence

const preview = (over: Partial<AbsenceIcsImportResult> = {}): AbsenceIcsImportResult => ({
  dry_run: true,
  window_from: '2026-11-02',
  window_to: '2026-11-10',
  candidates: [
    candidate(),
    candidate({ source_uid: 'meet@x', title: 'Sprint review', selected_by_default: false, hint: 'timed event — looks like a meeting' }),
  ],
  removals: [stored()],
  skipped: [{ summary: 'Gym', reason: 'repeats daily; only weekly and yearly events are read' }],
  truncated_labels: 0,
  created: 1,
  updated: 0,
  unchanged: 0,
  deleted: 1,
  ...over,
})

function setup(result: AbsenceIcsImportResult = preview()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onClose = vi.fn()
  mockApi.post.mockImplementation((_url: string, _form: FormData, config: { params: { dry_run: boolean } }) =>
    Promise.resolve({ data: config.params.dry_run ? result : { ...result, dry_run: false } }),
  )
  render(
    <QueryClientProvider client={qc}>
      <AbsenceIcsImportDialog open teamId="t-1" members={MEMBERS} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { invalidate, onClose, user: userEvent.setup() }
}

const file = new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR'], 'anna.ics', { type: 'text/calendar' })

async function previewFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Calendar file'), file)
  await user.click(screen.getByRole('button', { name: /^preview$/i }))
  return screen.findByLabelText('Import preview')
}

function lastCall() {
  const [url, form, config] = mockApi.post.mock.calls[mockApi.post.mock.calls.length - 1] as [string, FormData, { params: Record<string, unknown> }]
  return { url, form, params: config.params }
}

describe('AbsenceIcsImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews for the picked member and lists events, removals and skips', async () => {
    const { user } = setup()
    const section = await previewFile(user)

    const { url, params, form } = lastCall()
    expect(url).toBe('/teams/t-1/absences/import/ics')
    expect(params).toMatchObject({ dry_run: true, member_id: 'm-anna' })
    expect(form.get('selections')).toBeNull()

    expect(within(section).getByRole('checkbox', { name: /import vacation/i })).toBeChecked()
    expect(within(section).getByRole('checkbox', { name: /import sprint review/i })).not.toBeChecked()
    expect(within(section).getByText(/looks like a meeting/i)).toBeInTheDocument()
    expect(within(section).getByRole('checkbox', { name: /remove doctor for anna keller/i })).toBeChecked()
    expect(within(section).getByText(/gym: repeats daily/i)).toBeInTheDocument()
    // The window comes back from the server and is shown for narrowing.
    expect(screen.getByLabelText('Window from')).toHaveValue('2026-11-02')
  })

  it('sends exactly the ticked rows and removals, with the preview window, then refreshes and closes', async () => {
    const { user, invalidate, onClose } = setup()
    const section = await previewFile(user)

    await user.click(within(section).getByRole('checkbox', { name: /import sprint review/i }))
    await user.click(within(section).getByRole('checkbox', { name: /remove doctor/i }))
    await user.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const { params, form } = lastCall()
    expect(params).toMatchObject({ dry_run: false, member_id: 'm-anna', window_from: '2026-11-02', window_to: '2026-11-10' })
    expect(JSON.parse(form.get('selections') as string)).toEqual([
      { source_uid: 'week@x', member_id: 'm-anna' },
      { source_uid: 'meet@x', member_id: 'm-anna' },
    ])
    expect(JSON.parse(form.get('removals') as string)).toEqual([])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['absences', 't-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['teamCapacity', 't-1'] })
  })

  it('a preview never refreshes the absences', async () => {
    const { user, invalidate } = setup()
    await previewFile(user)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('blocks the import until an unmatched ticked event has a member', async () => {
    const { user } = setup(preview({
      candidates: [candidate({ source_uid: 'c@x', title: 'Someone away', member_id: null, match: 'none', action: null })],
      removals: [],
    }))
    await user.click(screen.getByRole('radio', { name: /match events to members by name/i }))
    const section = await previewFile(user)
    expect(lastCall().params.member_id).toBeUndefined()

    const importButton = screen.getByRole('button', { name: /^import$/i })
    expect(importButton).toBeDisabled()
    expect(within(section).getByText(/choose a member for the ticked event/i)).toBeInTheDocument()

    await user.selectOptions(within(section).getByRole('combobox', { name: /member for someone away/i }), 'm-ben')
    expect(importButton).toBeEnabled()
    await user.click(importButton)

    await waitFor(() => expect(lastCall().params.dry_run).toBe(false))
    expect(JSON.parse(lastCall().form.get('selections') as string)).toEqual([{ source_uid: 'c@x', member_id: 'm-ben' }])
  })

  it('shows an update with the rule it replaces, and tucks unchanged rows away', async () => {
    const { user } = setup(preview({
      candidates: [
        candidate({ action: 'update', previous: stored({ summary: '2026-10-26 – 2026-10-30, from am to pm' }) }),
        candidate({ source_uid: 'same@x', title: 'Same as before', action: 'unchanged' }),
      ],
      removals: [],
    }))
    const section = await previewFile(user)
    expect(within(section).getByText('update')).toBeInTheDocument()
    expect(within(section).getByText('2026-10-26 – 2026-10-30, from am to pm')).toBeInTheDocument()
    expect(within(section).getByText('1 unchanged')).toBeInTheDocument()
    // Only the update is a write; the unchanged row costs nothing.
    expect(screen.getByText(/1 to write · 0 to remove/)).toBeInTheDocument()
  })

  it('says why the server refused the file', async () => {
    const { user } = setup()
    mockApi.post.mockRejectedValueOnce(
      new AxiosError('422', '422', undefined, undefined, {
        status: 422, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
        data: { detail: { error: 'INVALID_ICS', message: 'This is not a readable iCalendar file: bad' } },
      }),
    )
    await user.upload(screen.getByLabelText('Calendar file'), file)
    await user.click(screen.getByRole('button', { name: /^preview$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a readable iCalendar file')
  })
})
