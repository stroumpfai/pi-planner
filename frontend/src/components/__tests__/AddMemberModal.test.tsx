import { vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddMemberModal } from '../AddMemberModal'
import * as apiModule from '@/services/api'
import type { PatternVersion, TeamMember } from '@/types'

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

const existing: TeamMember = {
  system_id: 'm-1',
  team_id: 't-1',
  name: 'Katrin Hofstetter',
  role: 'UX',
  organisation: 'BIT',
  active_from: null,
  active_to: null,
  order_index: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"tag"',
  effective_version: {
    system_id: 'v-1', member_id: 'm-1', effective_from: '2026-01-01',
    mon_am: false, mon_pm: false,
    tue_am: true, tue_pm: true,
    wed_am: true, wed_pm: true,
    thu_am: true, thu_pm: true,
    fri_am: false, fri_pm: false,
    sat_am: false, sat_pm: false,
    sun_am: false, sun_pm: false,
    hours_per_day: 8, focus: 0.9, note: '60%',
    created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-01T00:00:00Z', etag: '"v"',
  } as PatternVersion,
  version_dates: ['2026-01-01'],
  absence_count: 0,
  meeting_count: 0,
}

describe('AddMemberModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.post.mockResolvedValue({ data: { ...existing }, headers: {} })
  })

  it('creates the member and their first pattern in one request', async () => {
    // The two cannot be separated: a member with no version computes as zero
    // capacity and reads as a bug rather than as missing data (teams.md §3.3).
    render(<AddMemberModal open teamId="t-1" members={[]} onClose={vi.fn()} />, { wrapper: wrapper() })

    await userEvent.type(screen.getByLabelText(/^Name/), 'Tomas Bergerat')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const [url, body] = mockApi.post.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/teams/t-1/members')
    expect(body.name).toBe('Tomas Bergerat')
    const pattern = body.pattern as Record<string, unknown>
    expect(pattern.mon_am).toBe(true)
    expect(pattern.sat_am).toBe(false)
    expect(pattern.hours_per_day).toBe(8)
    expect(pattern.focus).toBe(1)
  })

  it('leaves the pattern start blank so the backend dates it to the joining day', async () => {
    render(<AddMemberModal open teamId="t-1" members={[]} onClose={vi.fn()} />, { wrapper: wrapper() })

    await userEvent.type(screen.getByLabelText(/^Name/), 'Jonas Wehrli')
    await userEvent.type(screen.getByLabelText('On the team from'), '01.10.2026')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>
    expect(body.active_from).toBe('2026-10-01')
    expect((body.pattern as Record<string, unknown>).effective_from).toBeNull()
  })

  it('turns Friday off with the 80% preset', async () => {
    render(<AddMemberModal open teamId="t-1" members={[]} onClose={vi.fn()} />, { wrapper: wrapper() })

    await userEvent.type(screen.getByLabelText(/^Name/), 'Part Timer')
    await userEvent.click(screen.getByRole('button', { name: '80% — Fri off' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const pattern = (mockApi.post.mock.calls[0][1] as Record<string, unknown>).pattern as Record<string, unknown>
    expect(pattern.thu_pm).toBe(true)
    expect(pattern.fri_am).toBe(false)
  })

  it('copies another member’s contract when asked to', async () => {
    render(<AddMemberModal open teamId="t-1" members={[existing]} onClose={vi.fn()} />, { wrapper: wrapper() })

    await userEvent.type(screen.getByLabelText(/^Name/), 'New Person')
    await userEvent.selectOptions(screen.getByLabelText('Copy pattern from'), 'm-1')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const pattern = (mockApi.post.mock.calls[0][1] as Record<string, unknown>).pattern as Record<string, unknown>
    expect(pattern.mon_am).toBe(false)
    expect(pattern.tue_am).toBe(true)
    expect(pattern.focus).toBe(0.9)
  })

  it('suggests the roles this team already uses, and still takes anything typed', async () => {
    // Free text with suggestions, not a vocabulary: there is no roles table
    // behind it and nothing rejects an unknown value (§3.2).
    render(<AddMemberModal open teamId="t-1" members={[existing]} onClose={vi.fn()} />, { wrapper: wrapper() })

    const role = screen.getByLabelText('Role')
    expect(role).toHaveAttribute('list', 'role-suggestions')
    expect(document.querySelector('#role-suggestions option[value="UX"]')).not.toBeNull()

    await userEvent.type(screen.getByLabelText(/^Name/), 'Odd Job')
    await userEvent.type(role, 'Chief Whittler')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect((mockApi.post.mock.calls[0][1] as Record<string, unknown>).role).toBe('Chief Whittler')
  })

  it('explains a name the team already holds', async () => {
    mockApi.post.mockRejectedValue({
      response: { status: 409, data: { detail: { error: 'MEMBER_NAME_TAKEN', message: 'taken' } } },
    })
    render(<AddMemberModal open teamId="t-1" members={[existing]} onClose={vi.fn()} />, { wrapper: wrapper() })

    await userEvent.type(screen.getByLabelText(/^Name/), 'Katrin Hofstetter')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    expect(await screen.findByText(/already has a member with that name/)).toBeInTheDocument()
  })
})
