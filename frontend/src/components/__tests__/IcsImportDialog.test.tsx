import { vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { IcsImportDialog } from '../IcsImportDialog'
import * as apiModule from '@/services/api'
import type { IcsImportResult } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { post: Mock }

const THIS_YEAR = new Date().getFullYear()

const result = (over: Partial<IcsImportResult> = {}): IcsImportResult => ({
  dry_run: true,
  created: 2,
  duplicates: 1,
  skipped: [{ summary: 'Team standup', reason: 'repeats weekly; only yearly events are read' }],
  truncated_labels: 3,
  entries: [
    { label: 'New Year', start_date: '2027-01-01', start_half: 'am', end_date: '2027-01-01', end_half: 'pm' },
    { label: 'Christmas Eve', start_date: '2027-12-24', start_half: 'pm', end_date: '2027-12-24', end_half: 'pm' },
  ],
  ...over,
})

function apiError(message: string) {
  return new AxiosError('422', '422', undefined, undefined, {
    status: 422, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
    data: { detail: { error: 'INVALID_ICS', message } },
  })
}

function setup(preview: IcsImportResult = result()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onClose = vi.fn()
  mockApi.post.mockImplementation((_url: string, _form: FormData, config: { params: { dry_run: boolean } }) =>
    Promise.resolve({ data: { ...preview, dry_run: config.params.dry_run } }),
  )
  const ui = (open: boolean) => (
    <QueryClientProvider client={qc}>
      <IcsImportDialog open={open} calendarId="c-1" calendarName="Switzerland" onClose={onClose} />
    </QueryClientProvider>
  )
  const view = render(ui(true))
  return { invalidate, onClose, reopen: () => { view.rerender(ui(false)); view.rerender(ui(true)) }, user: userEvent.setup() }
}

const file = new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR'], 'ch.ics', { type: 'text/calendar' })

async function previewFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Calendar file'), file)
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  return screen.findByLabelText('Import preview')
}

function lastCall() {
  const [url, form, config] = mockApi.post.mock.calls[mockApi.post.mock.calls.length - 1] as [
    string, FormData, { headers: Record<string, string>; params: Record<string, unknown> },
  ]
  return { url, form, config }
}

describe('IcsImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the calendar and needs a file before it can preview', async () => {
    const { user } = setup()
    expect(screen.getByRole('dialog', { name: 'Import .ics into Switzerland' })).toBeInTheDocument()
    const previewButton = screen.getByRole('button', { name: 'Preview' })
    expect(previewButton).toBeDisabled()
    await user.upload(screen.getByLabelText('Calendar file'), file)
    expect(previewButton).toBeEnabled()
  })

  it('previews as a dry run over this year and next, listing what would be added and what was skipped', async () => {
    const { user, invalidate } = setup()
    const section = await previewFile(user)

    const { url, form, config } = lastCall()
    expect(url).toBe('/holiday-calendars/c-1/import/ics')
    expect(form.get('file')).toBe(file)
    expect(config.params).toEqual({ dry_run: true, from_year: THIS_YEAR, to_year: THIS_YEAR + 1 })
    expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' })

    expect(within(section).getByText('2 to add · 1 already there · 1 skipped')).toBeInTheDocument()
    expect(within(section).getByText('2027-01-01 · New Year')).toBeInTheDocument()
    expect(within(section).getByText('2027-12-24 afternoon · Christmas Eve')).toBeInTheDocument()
    expect(within(section).getByText('Team standup: repeats weekly; only yearly events are read')).toBeInTheDocument()
    expect(within(section).getByText('3 long titles were shortened to 100 characters.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 2' })).toBeEnabled()
    // A dry run writes nothing, so nothing is refreshed.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('imports the same file for real, refreshes every holiday cache, then closes', async () => {
    const { user, invalidate, onClose } = setup()
    await previewFile(user)
    await user.click(screen.getByRole('button', { name: 'Add 2' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const { form, config } = lastCall()
    expect(form.get('file')).toBe(file)
    expect(config.params).toEqual({ dry_run: false, from_year: THIS_YEAR, to_year: THIS_YEAR + 1 })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['holidayCalendars'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['holidayCalendar'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['teamCapacity'] })
  })

  it('shows a bare summary and offers no import when nothing is new', async () => {
    const { user } = setup(result({ created: 0, duplicates: 4, skipped: [], truncated_labels: 0, entries: [] }))
    const section = await previewFile(user)
    expect(within(section).getByText('0 to add · 4 already there')).toBeInTheDocument()
    expect(within(section).queryByRole('list')).not.toBeInTheDocument()
    expect(within(section).queryByText(/shortened/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0' })).toBeDisabled()
  })

  it('sends the years asked for, and refuses a range that runs backwards', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText('Calendar file'), file)
    const from = screen.getByRole('spinbutton', { name: 'From year' })
    const to = screen.getByRole('spinbutton', { name: 'To year' })
    expect(from).toHaveValue(THIS_YEAR)
    expect(to).toHaveValue(THIS_YEAR + 1)

    await user.clear(to)
    await user.type(to, '2020')
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()

    await user.clear(from)
    await user.type(from, '2019')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByLabelText('Import preview')
    expect(lastCall().config.params).toMatchObject({ from_year: 2019, to_year: 2020 })
  })

  it('drops the preview when the years or the file change', async () => {
    const { user } = setup()
    await previewFile(user)
    await user.type(screen.getByRole('spinbutton', { name: 'To year' }), '0')
    expect(screen.queryByLabelText('Import preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByLabelText('Import preview')
    await user.type(screen.getByRole('spinbutton', { name: 'From year' }), '{Backspace}')
    expect(screen.queryByLabelText('Import preview')).not.toBeInTheDocument()

    await user.upload(screen.getByLabelText('Calendar file'), new File(['x'], 'other.ics'))
    expect(screen.queryByLabelText('Import preview')).not.toBeInTheDocument()
  })

  it('cannot preview once the file is cleared', async () => {
    const { user } = setup()
    const input = screen.getByLabelText('Calendar file')
    await user.upload(input, file)
    fireEvent.change(input, { target: { files: [] } })
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('disables Preview while the file is being read', async () => {
    const { user } = setup()
    mockApi.post.mockImplementation(() => new Promise(() => undefined))
    await user.upload(screen.getByLabelText('Calendar file'), file)
    const previewButton = screen.getByRole('button', { name: 'Preview' })
    await user.click(previewButton)
    expect(previewButton).toBeDisabled()
  })

  it('says why the server refused the file', async () => {
    const { user } = setup()
    mockApi.post.mockRejectedValueOnce(apiError('This is not a readable iCalendar file: bad'))
    await user.upload(screen.getByLabelText('Calendar file'), file)
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a readable iCalendar file: bad')
    // The button comes back so the planner can retry.
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  })

  it('falls back to a generic message, and clears it on the next attempt', async () => {
    const { user } = setup()
    mockApi.post.mockRejectedValueOnce(new Error('Network Error'))
    await user.upload(screen.getByLabelText('Calendar file'), file)
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that file.')

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByLabelText('Import preview')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the preview and stays open when the real import fails', async () => {
    const { user, onClose, invalidate } = setup()
    await previewFile(user)
    mockApi.post.mockRejectedValueOnce(apiError('This calendar already holds 500 holidays'))
    await user.click(screen.getByRole('button', { name: 'Add 2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This calendar already holds 500 holidays')
    expect(onClose).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Import preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 2' })).toBeEnabled()
  })

  it('closes on Cancel and on Escape, and opens again empty', async () => {
    const { user, onClose, reopen } = setup()
    mockApi.post.mockRejectedValueOnce(new Error('x'))
    await user.upload(screen.getByLabelText('Calendar file'), file)
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByLabelText('Import preview')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    reopen()
    expect(screen.queryByLabelText('Import preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The file went with it: there is nothing to preview until one is chosen again.
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(mockApi.post).toHaveBeenCalledTimes(2)
  })
})
