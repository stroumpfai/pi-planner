import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChangePatternModal } from '../ChangePatternModal'
import { useAddPatternVersion, useMemberVersions } from '@/hooks/useTeamMembers'
import type { PatternVersion, TeamMember } from '@/types'

vi.mock('@/hooks/useTeamMembers')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const version = (over: Partial<PatternVersion> = {}): PatternVersion =>
  ({
    system_id: 'v-1',
    member_id: 'm-1',
    effective_from: '2026-01-01',
    mon_am: true, mon_pm: true,
    tue_am: true, tue_pm: true,
    wed_am: true, wed_pm: true,
    thu_am: true, thu_pm: true,
    fri_am: true, fri_pm: false,
    sat_am: false, sat_pm: false,
    sun_am: false, sun_pm: false,
    hours_per_day: 8,
    focus: 0.8,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"2026-01-01T00:00:00+00:00"',
    ...over,
  }) as PatternVersion

const member = {
  system_id: 'm-1',
  name: 'Aïcha Ben Salah',
  effective_version: version(),
  version_dates: ['2026-01-01'],
} as unknown as TeamMember

const props = (over: Partial<React.ComponentProps<typeof ChangePatternModal>> = {}) => ({
  open: true,
  teamId: 't-1',
  member,
  defaultDate: '2026-01-01',
  onClose: vi.fn(),
  onSaved: vi.fn(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAddPatternVersion).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useAddPatternVersion>)
  vi.mocked(useMemberVersions).mockReturnValue({
    data: [version()],
  } as ReturnType<typeof useMemberVersions>)
})

describe('ChangePatternModal', () => {
  it('quotes the replaced version’s ETag when the date is already taken (§4.2)', async () => {
    mutateAsync.mockResolvedValue({})
    render(<ChangePatternModal {...props()} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ etag: '"2026-01-01T00:00:00+00:00"' }),
      ),
    )
  })

  it('sends no ETag for a date that is free — a create cannot clobber', async () => {
    mutateAsync.mockResolvedValue({})
    render(<ChangePatternModal {...props({ defaultDate: '2026-09-01' })} />, {
      wrapper: makeWrapper(),
    })

    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync.mock.calls[0][0].etag).toBeUndefined()
  })

  it('says the version moved rather than "try again" when the write is stale', async () => {
    mutateAsync.mockRejectedValue({
      response: { status: 412, data: { detail: { error: 'STALE', message: 'moved' } } },
    })
    const onSaved = vi.fn()
    render(<ChangePatternModal {...props({ onSaved })} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    expect(await screen.findByText(/changed while you had this open/i)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
