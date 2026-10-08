import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { CopyYearDialog } from '../CopyYearDialog'
import * as apiModule from '@/services/api'
import type { CopyYearPreview, CopyYearProposal } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock }

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const proposal = (over: Partial<CopyYearProposal> = {}): CopyYearProposal => ({
  label: 'New Year',
  start_date: '2027-01-01', // a Friday
  start_half: 'am',
  end_date: null,
  end_half: 'pm',
  source_start_date: '2026-01-01',
  on_weekend: false,
  duplicate: false,
  ...over,
})

const PROPOSALS: CopyYearProposal[] = [
  proposal(),
  proposal({ label: 'Christmas break', start_date: '2027-12-24', end_date: '2027-12-26', source_start_date: '2026-12-24' }),
  proposal({ label: 'National day', start_date: '2027-08-01', source_start_date: '2026-08-01', on_weekend: true, duplicate: true }),
]

const preview = (proposals: CopyYearProposal[] = PROPOSALS): CopyYearPreview => ({
  from_year: 2026,
  to_year: 2027,
  proposals,
})

function apiError(message: string) {
  return new AxiosError('422', '422', undefined, undefined, {
    status: 422, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
    data: { detail: { error: 'INVALID_HOLIDAY', message } },
  })
}

function setup(props: Partial<React.ComponentProps<typeof CopyYearDialog>> = {}) {
  const onClose = vi.fn()
  const view = render(
    <CopyYearDialog open calendarId="c-1" fromYear={2026} onClose={onClose} {...props} />,
    { wrapper: makeWrapper() },
  )
  return { onClose, view, user: userEvent.setup() }
}

const row = (label: string) => screen.getByRole('row', { name: new RegExp(label) })
const dates = (label: string) => within(row(label)).getAllByRole('textbox') as [HTMLInputElement, HTMLInputElement]

async function retype(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  if (value) await user.type(input, value)
  await user.tab()
}

function sentEntries() {
  const [url, body] = mockApi.post.mock.calls[mockApi.post.mock.calls.length - 1] as [string, { entries: unknown[] }]
  return { url, entries: body.entries }
}

describe('CopyYearDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation(() => Promise.resolve({ data: preview() }))
    mockApi.post.mockImplementation(() => Promise.resolve({ data: { created: 2 } }))
  })

  it('asks for the year it copies from and proposes each holiday, leaving duplicates unticked', async () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Copy 2026 to 2027' })).toBeInTheDocument()
    expect(screen.getByText('Preparing…')).toBeInTheDocument()

    expect(await screen.findByRole('checkbox', { name: 'Copy New Year' })).toBeChecked()
    expect(mockApi.get).toHaveBeenCalledWith('/holiday-calendars/c-1/copy-year', { params: { from_year: 2026 } })
    expect(screen.getByRole('checkbox', { name: 'Copy Christmas break' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Copy National day' })).not.toBeChecked()
    expect(within(row('National day')).getByText('already in 2027')).toBeInTheDocument()
    expect(within(row('New Year')).queryByText(/already in/)).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'First day 2027' })).toBeInTheDocument()
    // A missing end date reads as a one-day holiday.
    expect(dates('New Year').map((d) => d.value)).toEqual(['01.01.2027', '01.01.2027'])
    expect(dates('Christmas break').map((d) => d.value)).toEqual(['24.12.2027', '26.12.2027'])
    expect(screen.getByRole('button', { name: 'Copy 2 holidays' })).toBeEnabled()
    expect(screen.queryByText('Preparing…')).not.toBeInTheDocument()
  })

  it('flags a proposal that lands on a weekend', async () => {
    setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    expect(within(row('National day')).getByText('Sun · weekend')).toBeInTheDocument()
    expect(within(row('New Year')).getByText('Fri')).toBeInTheDocument()
    expect(within(row('New Year')).queryByText(/weekend/)).not.toBeInTheDocument()
  })

  it('copies exactly the ticked rows, then closes', async () => {
    const { user, onClose } = setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Copy Christmas break' }))
    await user.click(screen.getByRole('checkbox', { name: 'Copy National day' }))
    await user.click(screen.getByRole('button', { name: 'Copy 2 holidays' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const { url, entries } = sentEntries()
    expect(url).toBe('/holiday-calendars/c-1/copy-year')
    expect(entries).toEqual([
      { label: 'New Year', start_date: '2027-01-01', start_half: 'am', end_date: '2027-01-01', end_half: 'pm' },
      { label: 'National day', start_date: '2027-08-01', start_half: 'am', end_date: '2027-08-01', end_half: 'pm' },
    ])
  })

  it('says "holiday" for one and disables the copy when nothing is ticked', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Copy New Year' }))
    expect(screen.getByRole('button', { name: 'Copy 1 holiday' })).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: 'Copy Christmas break' }))
    expect(screen.getByRole('button', { name: 'Copy 0 holidays' })).toBeDisabled()
  })

  it('moves the last day with the first, keeping a multi-day holiday its length', async () => {
    const { user } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    const [start, end] = dates('Christmas break')
    await retype(user, start, '23.12.2027')
    expect(end).toHaveValue('25.12.2027')
    expect(within(row('Christmas break')).getByText('Thu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Copy \d/ }))
    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(sentEntries().entries).toContainEqual(
      expect.objectContaining({ label: 'Christmas break', start_date: '2027-12-23', end_date: '2027-12-25' }),
    )
  })

  it('moves a one-day holiday as one day', async () => {
    const { user } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    const [start, end] = dates('New Year')
    await retype(user, start, '04.01.2027')
    expect(end).toHaveValue('04.01.2027')
    expect(within(row('New Year')).getByText('Mon')).toBeInTheDocument()
  })

  it('does not drag the last day back when it was set before the first', async () => {
    const { user } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    const [start, end] = dates('Christmas break')
    await retype(user, end, '20.12.2027')
    await retype(user, start, '27.12.2027')
    // A negative span is not carried over: the last day becomes the first.
    expect(end).toHaveValue('27.12.2027')
  })

  it('sends a last day that is before the first as a one-day holiday', async () => {
    const { user } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    await retype(user, dates('Christmas break')[1], '20.12.2027')
    await user.click(screen.getByRole('button', { name: 'Copy 2 holidays' }))
    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(sentEntries().entries).toContainEqual(
      expect.objectContaining({ label: 'Christmas break', start_date: '2027-12-24', end_date: '2027-12-24' }),
    )
  })

  it('drops the weekday hint when the first day is cleared', async () => {
    const { user } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    await retype(user, dates('New Year')[0], '')
    expect(within(row('New Year')).queryByText('Fri')).not.toBeInTheDocument()
  })

  it('says so when the year has no holidays', async () => {
    mockApi.get.mockImplementation(() => Promise.resolve({ data: preview([]) }))
    setup()
    expect(await screen.findByText('This calendar has no holidays starting in 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy 0 holidays' })).toBeDisabled()
  })

  it("shows the server's reason when the preview fails", async () => {
    mockApi.get.mockImplementation(() => Promise.reject(apiError('Calendar not found')))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar not found')
    expect(screen.queryByText('Preparing…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy 0 holidays' })).toBeDisabled()
  })

  it('falls back to a generic message when the preview fails without one', async () => {
    mockApi.get.mockImplementation(() => Promise.reject(new Error('Network Error')))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare the copy.')
  })

  it("keeps the dialog open with the server's reason when the copy fails", async () => {
    mockApi.post.mockImplementation(() => Promise.reject(apiError('Too many holidays in 2027')))
    const { user, onClose } = setup()
    await user.click(await screen.findByRole('button', { name: 'Copy 2 holidays' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many holidays in 2027')
    expect(onClose).not.toHaveBeenCalled()
    // Rows survive the failure, so the planner can retry.
    expect(screen.getByRole('checkbox', { name: 'Copy New Year' })).toBeChecked()
  })

  it('falls back to a generic message when the copy fails without one, and clears it on retry', async () => {
    mockApi.post.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const { user, onClose } = setup()
    const copy = await screen.findByRole('button', { name: 'Copy 2 holidays' })
    await user.click(copy)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy those holidays.')

    await user.click(copy)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the copy while it is being sent', async () => {
    mockApi.post.mockImplementation(() => new Promise(() => undefined))
    const { user } = setup()
    const copy = await screen.findByRole('button', { name: 'Copy 2 holidays' })
    await user.click(copy)
    await waitFor(() => expect(copy).toBeDisabled())
  })

  it('closes on Cancel and on Escape without copying', async () => {
    const { user, onClose } = setup()
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('asks for nothing while closed, and prepares afresh each time it opens', async () => {
    const { view } = setup({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.get).not.toHaveBeenCalled()

    view.rerender(<CopyYearDialog open calendarId="c-1" fromYear={2027} onClose={vi.fn()} />)
    await screen.findByRole('checkbox', { name: 'Copy New Year' })
    expect(mockApi.get).toHaveBeenCalledWith('/holiday-calendars/c-1/copy-year', { params: { from_year: 2027 } })
    expect(screen.getByRole('dialog', { name: 'Copy 2027 to 2028' })).toBeInTheDocument()
  })
})
