import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
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
    vi.useFakeTimers({ toFake: ['Date'] })
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
    // The section is there from the start; wait for its rows, so the list's arrival happens inside RTL's act.
    expect(await within(list).findByText(/Platform/)).toBeInTheDocument()
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

describe('CalendarsPage — editing a calendar', () => {
  const second: HolidayCalendarSummary = {
    ...summary,
    system_id: 'c-2',
    name: 'Zurich',
    description: null,
    entry_count: 3,
    first_year: 2026,
    last_year: 2027,
    teams: [],
    etag: '"c2"',
  }
  const secondDetail: HolidayCalendarDetail = { ...second, entries: [] }
  const empty: HolidayCalendarSummary = { ...second, system_id: 'c-3', name: 'Empty', entry_count: 0, first_year: null, last_year: null }

  function apiError(message: string) {
    return new AxiosError('409', '409', undefined, undefined, {
      status: 409, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
      data: { detail: { error: 'CALENDAR_NAME_TAKEN', message } },
    })
  }

  function routeGet(list: HolidayCalendarSummary[], details: Record<string, HolidayCalendarDetail> = { 'c-1': detail, 'c-2': secondDetail }) {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/holiday-calendars') return Promise.resolve({ data: list })
      if (url.endsWith('/copy-year')) return Promise.resolve({ data: { from_year: 2026, to_year: 2027, proposals: [] } })
      const id = url.split('/')[2]
      return Promise.resolve({ data: details[id] })
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    routeGet([summary, second, empty])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invites a first calendar when there are none', async () => {
    routeGet([])
    render(<CalendarsPage />, { wrapper: wrapper() })
    expect(await screen.findByText(/No holiday calendars yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete calendar' })).not.toBeInTheDocument()
  })

  it('summarises each calendar and opens the one clicked', async () => {
    render(<CalendarsPage />, { wrapper: wrapper() })
    const list = await screen.findByRole('region', { name: 'Holiday calendars' })
    const zurich = await within(list).findByRole('button', { name: /Zurich/ })
    expect(zurich).toHaveTextContent('3 holidays · 2026–2027 · no team')
    expect(within(list).getByRole('button', { name: /Switzerland/ })).toHaveTextContent('1 holiday · 2026 · Platform')
    expect(within(list).getByRole('button', { name: /Empty/ })).toHaveTextContent('0 holidays · no team')
    await screen.findByRole('region', { name: 'Switzerland' })

    await userEvent.click(zurich)
    const opened = await screen.findByRole('region', { name: 'Zurich' })
    expect(zurich).toHaveAttribute('aria-current', 'true')
    expect(within(opened).getByText('Not enabled by any team yet.')).toBeInTheDocument()
    expect(within(opened).getByText('No holidays in 2026.')).toBeInTheDocument()
  })

  it('creates a calendar and opens it', async () => {
    const created: HolidayCalendarDetail = { ...secondDetail, system_id: 'c-new', name: 'Geneva' }
    routeGet([summary], { 'c-1': detail, 'c-new': created })
    mockApi.post.mockResolvedValue({ data: created })
    render(<CalendarsPage />, { wrapper: wrapper() })
    await screen.findByRole('region', { name: 'Switzerland' })

    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Geneva')
    await userEvent.click(create)

    expect(await screen.findByRole('region', { name: 'Geneva' })).toBeInTheDocument()
    expect(mockApi.post).toHaveBeenCalledWith('/holiday-calendars', { name: 'Geneva' })
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  })

  it("keeps the new-calendar form open with the server's reason, and Cancel drops it", async () => {
    mockApi.post.mockRejectedValue(apiError('A calendar called Switzerland already exists'))
    render(<CalendarsPage />, { wrapper: wrapper() })
    await screen.findByRole('region', { name: 'Switzerland' })
    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Switzerland')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A calendar called Switzerland already exists')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Calendar name')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Switzerland' })).toBeInTheDocument()
  })

  it('renames a calendar, quoting its ETag and sending a blank description as none', async () => {
    mockApi.patch.mockResolvedValue({ data: detail })
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })
    await userEvent.click(within(opened).getByRole('button', { name: 'Rename' }))
    const name = within(opened).getByRole('textbox', { name: 'Calendar name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Schweiz')
    await userEvent.clear(within(opened).getByRole('textbox', { name: 'Description' }))
    await userEvent.click(within(opened).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(within(opened).queryByRole('textbox', { name: 'Calendar name' })).not.toBeInTheDocument())
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/holiday-calendars/c-1', { name: 'Schweiz', description: null }, { headers: { 'If-Match': '"c"' } },
    )
  })

  it('keeps the rename open on a failed save, and Cancel leaves it untouched', async () => {
    mockApi.patch.mockRejectedValue(new Error('412'))
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })
    await userEvent.click(within(opened).getByRole('button', { name: 'Rename' }))
    expect(within(opened).getByRole('textbox', { name: 'Description' })).toHaveValue('Federal holidays')
    await userEvent.click(within(opened).getByRole('button', { name: 'Save' }))
    expect(await within(opened).findByRole('alert')).toHaveTextContent('Could not save — someone may have changed it.')
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/holiday-calendars/c-1', { name: 'Switzerland', description: 'Federal holidays' }, { headers: { 'If-Match': '"c"' } },
    )

    await userEvent.click(within(opened).getByRole('button', { name: 'Cancel' }))
    expect(within(opened).getByRole('heading', { name: 'Switzerland' })).toBeInTheDocument()
  })

  it('steps through the years', async () => {
    render(<CalendarsPage />, { wrapper: wrapper() })
    // Each year is its own query, so the section is re-rendered: find it afresh every time.
    const region = () => screen.findByRole('region', { name: 'Switzerland' })
    await userEvent.click(within(await region()).getByRole('button', { name: 'Next year' }))
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/holiday-calendars/c-1', { params: { year: 2027 } }))
    expect(await screen.findByRole('button', { name: 'Copy 2027 to 2028' })).toBeInTheDocument()
    await userEvent.click(within(await region()).getByRole('button', { name: 'Previous year' }))
    await screen.findByRole('button', { name: 'Copy 2026 to 2027' })
    await userEvent.click(within(await region()).getByRole('button', { name: 'Previous year' }))
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/holiday-calendars/c-1', { params: { year: 2025 } }))
  })

  it('opens the copy, import and edit dialogs for this calendar', async () => {
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })

    await userEvent.click(within(opened).getByRole('button', { name: 'Copy 2026 to 2027' }))
    expect(await screen.findByRole('dialog', { name: 'Copy 2026 to 2027' })).toBeInTheDocument()
    await screen.findByText('This calendar has no holidays starting in 2026.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(opened).getByRole('button', { name: 'Import .ics' }))
    expect(await screen.findByRole('dialog', { name: 'Import .ics into Switzerland' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(opened).getByRole('button', { name: 'Edit National day' }))
    const edit = await screen.findByRole('dialog')
    expect(within(edit).getByLabelText('Label')).toHaveValue('National day')
    await userEvent.click(within(edit).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('deletes a holiday, warning that its "works this holiday" marks go with it', async () => {
    const marked: HolidayCalendarDetail = { ...detail, entries: [{ ...detail.entries[0], exception_days: ['2026-08-01', '2026-08-01'] }] }
    routeGet([summary], { 'c-1': marked })
    mockApi.delete.mockResolvedValue({ data: null })
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })
    expect(within(opened).getByRole('row', { name: /National day/ })).toHaveTextContent('2')

    await userEvent.click(within(opened).getByRole('button', { name: 'Delete National day' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete holiday' })
    expect(confirm).toHaveTextContent('Delete National day (2026-08-01)? Its 2 "works this holiday" marks go with it. This cannot be undone.')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockApi.delete).toHaveBeenCalledWith('/holiday-calendars/c-1/entries/e-1', { headers: { 'If-Match': '"e"' } })
  })

  it('says so when a holiday cannot be deleted, and Cancel deletes nothing', async () => {
    mockApi.delete.mockRejectedValue(apiError('Someone changed this holiday'))
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })

    await userEvent.click(within(opened).getByRole('button', { name: 'Delete National day' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete holiday' })
    expect(confirm).toHaveTextContent('Delete National day (2026-08-01)? This cannot be undone.')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockApi.delete).not.toHaveBeenCalled()

    await userEvent.click(within(opened).getByRole('button', { name: 'Delete National day' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await within(opened).findByRole('alert')).toHaveTextContent('Someone changed this holiday')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes a calendar no team uses, quoting its ETag', async () => {
    routeGet([second], { 'c-2': secondDetail })
    mockApi.delete.mockResolvedValue({ data: null })
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Zurich' })
    await userEvent.click(within(opened).getByRole('button', { name: 'Delete calendar' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete calendar' })
    expect(confirm).toHaveTextContent('Zurich and all its holidays will be permanently deleted.')
    expect(confirm).not.toHaveTextContent(/Used by/)
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/holiday-calendars/c-2', { headers: { 'If-Match': '"c2"' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so when a calendar cannot be deleted, and keeps it open', async () => {
    mockApi.delete.mockRejectedValue(new Error('Network Error'))
    render(<CalendarsPage />, { wrapper: wrapper() })
    const opened = await screen.findByRole('region', { name: 'Switzerland' })
    await userEvent.click(within(opened).getByRole('button', { name: 'Delete calendar' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await within(opened).findByRole('alert')).toHaveTextContent('Could not delete that calendar.')
    expect(screen.getByRole('region', { name: 'Switzerland' })).toBeInTheDocument()

    await userEvent.click(within(opened).getByRole('button', { name: 'Delete calendar' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
