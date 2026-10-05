import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CalendarsPage } from '../CalendarsPage'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { HolidayCalendarDetail, HolidayCalendarSummary, User } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }
})
vi.mock('@/hooks/useSSE', () => ({ useHolidayCalendarsSSE: () => undefined }))

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock; patch: Mock; delete: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const summary: HolidayCalendarSummary = {
  system_id: 'c-1',
  name: 'Switzerland',
  description: 'Federal holidays',
  entry_count: 1,
  first_year: 2026,
  last_year: 2026,
  teams: [{ system_id: 't-1', name: 'Platform' }],
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"c"',
}

const detail: HolidayCalendarDetail = {
  ...summary,
  entries: [{
    system_id: 'e-1',
    calendar_id: 'c-1',
    label: 'National day',
    start_date: '2026-08-01',
    start_half: 'am',
    end_date: '2026-08-01',
    end_half: 'pm',
    exception_days: [],
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"e"',
  }],
}

describe('CalendarsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    mockApi.get.mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/holiday-calendars' ? [summary] : detail, headers: {} }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists calendars with the teams using them and opens the first', async () => {
    render(<CalendarsPage />, { wrapper: wrapper() })
    const list = await screen.findByRole('region', { name: 'Holiday calendars' })
    expect(within(list).getByText(/Platform/)).toBeInTheDocument()
    const opened = await screen.findByRole('region', { name: 'Switzerland' })
    expect(within(opened).getByText('National day')).toBeInTheDocument()
    expect(within(opened).getByText('Sat')).toBeInTheDocument()
    expect(mockApi.get).toHaveBeenCalledWith('/holiday-calendars/c-1', { params: { year: 2026 } })
  })

  it('adds a holiday, naming the teams it reaches', async () => {
    mockApi.post.mockResolvedValue({ data: detail.entries[0] })
    render(<CalendarsPage />, { wrapper: wrapper() })
    await userEvent.click(await screen.findByRole('button', { name: '+ Add holiday' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Used by 1 team: Platform')
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Christmas')
    await userEvent.type(within(dialog).getByLabelText('First day'), '25.12.2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/holiday-calendars/c-1/entries', {
        label: 'Christmas', start_date: '2026-12-25', start_half: 'am', end_date: '2026-12-25', end_half: 'pm',
      }),
    )
  })

  it('warns which teams lose holidays before deleting a calendar', async () => {
    render(<CalendarsPage />, { wrapper: wrapper() })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete calendar' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Used by Platform\. Their capacity will rise/)
  })

  it('offers no writes to a reader', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<CalendarsPage />, { wrapper: wrapper() })
    await screen.findByRole('region', { name: 'Switzerland' })
    expect(screen.queryByRole('button', { name: '+ Add holiday' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export .ics' })).toHaveAttribute(
      'href', '/api/v1/holiday-calendars/c-1/export/ics',
    )
  })
})
