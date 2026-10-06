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
  repeats: 'single',
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

const many = (n: number, over: (i: number) => Partial<AbsenceImportCandidate> = () => ({})) =>
  Array.from({ length: n }, (_, i) =>
    candidate({ source_uid: `e${i}@x`, title: `Event ${i}`, rule: { ...rule, start_date: `2026-11-${String(i + 1).padStart(2, '0')}` }, ...over(i) }),
  )

describe('AbsenceIcsImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
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

  it('hides unmatched events behind a chip, and needs a member once one is ticked', async () => {
    const { user } = setup(preview({
      candidates: [
        candidate(),
        candidate({ source_uid: 'c@x', title: 'Someone away', member_id: null, match: 'none', action: null, selected_by_default: false }),
      ],
      removals: [],
    }))
    await user.click(screen.getByRole('radio', { name: /a shared team calendar/i }))
    const section = await previewFile(user)
    expect(lastCall().params.member_id).toBeUndefined()
    expect(within(section).queryByText('Someone away')).not.toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Unmatched (1)' }))
    await user.click(within(section).getByRole('checkbox', { name: /import someone away/i }))
    const importButton = screen.getByRole('button', { name: /^import$/i })
    expect(importButton).toBeDisabled()
    expect(screen.getByText(/choose a member for the ticked event/i)).toBeInTheDocument()

    await user.selectOptions(within(section).getByRole('combobox', { name: /member for someone away/i }), 'm-ben')
    expect(importButton).toBeEnabled()
    await user.click(importButton)

    await waitFor(() => expect(lastCall().params.dry_run).toBe(false))
    expect(JSON.parse(lastCall().form.get('selections') as string)).toEqual([
      { source_uid: 'week@x', member_id: 'm-anna' },
      { source_uid: 'c@x', member_id: 'm-ben' },
    ])
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
    expect(within(section).getByText('Update')).toBeInTheDocument()
    expect(within(section).getByText('2026-10-26 – 2026-10-30, from am to pm')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Unchanged (1)' })).toBeInTheDocument()
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

  it('deselects exactly the rows a search shows, and keeps the hidden ticks', async () => {
    const rows = [...many(3), ...many(2, (i) => ({ source_uid: `b${i}@x`, title: `Birthday ${i}` }))]
    const { user } = setup(preview({ candidates: rows, removals: [] }))
    const section = await previewFile(user)

    await user.type(within(section).getByRole('searchbox', { name: /search events/i }), 'birthday')
    expect(within(section).getAllByRole('checkbox', { name: /^import /i })).toHaveLength(2)
    await user.click(within(section).getByRole('button', { name: 'Deselect 2 shown' }))

    // The three hidden events stay ticked, and the footer says the filter hides them.
    expect(screen.getByText(/3 to write \(3 hidden by filters\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(lastCall().params.dry_run).toBe(false))
    expect(JSON.parse(lastCall().form.get('selections') as string).map((r: { source_uid: string }) => r.source_uid))
      .toEqual(['e0@x', 'e1@x', 'e2@x'])
  })

  it('shows a mixed header tick, and the header tick acts on the shown rows only', async () => {
    const { user } = setup(preview({ candidates: many(3, (i) => ({ selected_by_default: i === 0 })), removals: [] }))
    const section = await previewFile(user)
    const header = within(section).getByRole('checkbox', { name: /tick every shown event/i }) as HTMLInputElement
    expect(header.indeterminate).toBe(true)

    await user.click(header)
    expect(within(section).getAllByRole('checkbox', { name: /^import /i }).every((b) => (b as HTMLInputElement).checked)).toBe(true)
    expect(header.indeterminate).toBe(false)
  })

  it('filters by kind and by date', async () => {
    const rows = [
      ...many(2),
      candidate({ source_uid: 'y@x', title: 'Birthday Anna', repeats: 'yearly', selected_by_default: false, rule: { ...rule, start_date: '2027-03-15', end_date: '2027-03-15' } }),
    ]
    const { user } = setup(preview({ candidates: rows, removals: [] }))
    const section = await previewFile(user)

    await user.click(within(section).getByRole('button', { name: 'Yearly (1)' }))
    expect(within(section).getAllByRole('checkbox', { name: /^import /i })).toHaveLength(1)
    await user.click(within(section).getByRole('button', { name: /clear filters/i }))

    await user.type(within(section).getByLabelText('Show to'), '2026-12-31')
    expect(within(section).queryByText('Birthday Anna')).not.toBeInTheDocument()
    expect(within(section).getByText('Event 0')).toBeInTheDocument()
  })

  it('hides and unticks titles holding an exclude word, and remembers the words', async () => {
    const rows = [...many(1), candidate({ source_uid: 'b@x', title: "Ben's birthday party" })]
    const { user } = setup(preview({ candidates: rows, removals: [] }))
    const section = await previewFile(user)

    await user.type(screen.getByRole('textbox', { name: /hide titles containing/i }), 'Birthday')
    expect(within(section).queryByText("Ben's birthday party")).not.toBeInTheDocument()
    expect(screen.getByText(/1 events hidden and unticked/)).toBeInTheDocument()
    expect(screen.getByText(/^1 to write/)).toBeInTheDocument()
    expect(localStorage.getItem('absence-ics-exclude-words')).toBe('Birthday')
  })

  it('applies remembered exclude words to the next preview', async () => {
    localStorage.setItem('absence-ics-exclude-words', 'birthday')
    const rows = [...many(1), candidate({ source_uid: 'b@x', title: 'Birthday Ben' })]
    const { user } = setup(preview({ candidates: rows, removals: [] }))
    await previewFile(user)

    expect(screen.getByRole('textbox', { name: /hide titles containing/i })).toHaveValue('birthday')
    await user.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(lastCall().params.dry_run).toBe(false))
    expect(JSON.parse(lastCall().form.get('selections') as string)).toEqual([{ source_uid: 'e0@x', member_id: 'm-anna' }])
  })

  it('still opens when the browser refuses storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = setup()
    await previewFile(user)
    expect(screen.getByRole('textbox', { name: /hide titles containing/i })).toHaveValue('')
    getItem.mockRestore()
  })

  it('shows where a search hit is hiding, and the unmatched chip narrows to it', async () => {
    const rows = [
      candidate(),
      candidate({ source_uid: 'c@x', title: 'Someone away', member_id: null, match: 'none', action: null, selected_by_default: false }),
    ]
    const { user } = setup(preview({ candidates: rows, removals: [] }))
    await user.click(screen.getByRole('radio', { name: /a shared team calendar/i }))
    const section = await previewFile(user)

    await user.type(within(section).getByRole('searchbox', { name: /search events/i }), 'someone')
    expect(within(section).getByText('No event matches these filters.')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Matched (0)' })).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Unmatched (1)' }))

    expect(within(section).getByText('Someone away')).toBeInTheDocument()
    expect(within(section).queryByText('Vacation')).not.toBeInTheDocument()
  })

  it('keeps an unticked row on the Ticked only list, so a slip can be undone', async () => {
    const { user } = setup(preview({ candidates: many(2), removals: [] }))
    const section = await previewFile(user)

    await user.click(within(section).getByRole('button', { name: 'Ticked only' }))
    const first = within(section).getByRole('checkbox', { name: /import event 0/i })
    await user.click(first)
    expect(first).not.toBeChecked()
    await user.click(within(section).getByRole('checkbox', { name: /import event 0/i }))
    expect(within(section).getByRole('checkbox', { name: /import event 0/i })).toBeChecked()
  })
})

