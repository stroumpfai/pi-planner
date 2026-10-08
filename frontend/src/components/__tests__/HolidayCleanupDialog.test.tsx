import { vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { HolidayCleanupDialog } from '../HolidayCleanupDialog'
import * as apiModule from '@/services/api'
import type { HolidayCleanup, HolidayCleanupGroup } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock }

const group = (over: Partial<HolidayCleanupGroup> = {}): HolidayCleanupGroup => ({
  label: 'Christmas',
  start_date: '2026-12-24',
  start_half: 'am',
  end_date: '2026-12-26',
  end_half: 'pm',
  members: [
    { member_id: 'm-anna', name: 'Anna Keller', absence_id: 'a-1' },
    { member_id: 'm-ben', name: 'Ben Ott', absence_id: 'a-2' },
  ],
  ...over,
})

const GROUPS: HolidayCleanupGroup[] = [
  group(),
  group({
    label: null,
    start_date: '2026-08-01',
    end_date: '2026-08-01',
    members: [
      { member_id: 'm-anna', name: 'Anna Keller', absence_id: 'a-3' },
      { member_id: 'm-cleo', name: 'Cleo Roth', absence_id: 'a-4' },
    ],
  }),
]

function apiError(message: string) {
  return new AxiosError('409', '409', undefined, undefined, {
    status: 409, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
    data: { detail: { error: 'NOT_A_DUPLICATE', message } },
  })
}

function setup(cleanup: HolidayCleanup = { groups: GROUPS }, open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onClose = vi.fn()
  mockApi.get.mockImplementation(() => Promise.resolve({ data: cleanup }))
  mockApi.post.mockImplementation(() => Promise.resolve({ data: { deleted: 2 } }))
  const ui = (isOpen: boolean) => (
    <QueryClientProvider client={qc}>
      <HolidayCleanupDialog teamId="t-1" open={isOpen} onClose={onClose} />
    </QueryClientProvider>
  )
  const view = render(ui(open))
  return {
    invalidate,
    onClose,
    rerender: (isOpen: boolean) => view.rerender(ui(isOpen)),
    user: userEvent.setup(),
  }
}

describe('HolidayCleanupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists each duplicate with its dates and members, and ticks none of them', async () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Clean up duplicate absences' })).toBeInTheDocument()
    expect(screen.getByText('Looking for duplicates…')).toBeInTheDocument()

    const christmas = await screen.findByRole('checkbox', { name: /Christmas/ })
    expect(mockApi.get).toHaveBeenCalledWith('/teams/t-1/holiday-cleanup')
    expect(christmas).not.toBeChecked()
    expect(christmas).toHaveAccessibleName('Christmas · 2026-12-24 – 2026-12-26 Anna Keller, Ben Ott')
    expect(screen.getByRole('checkbox', { name: /Unlabelled absence · 2026-08-01 Anna Keller, Cleo Roth/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Delete ticked' })).toBeDisabled()
  })

  it('deletes the absences of the ticked groups only, refreshes, then closes', async () => {
    const { user, onClose, invalidate } = setup()
    await user.click(await screen.findByRole('checkbox', { name: /Unlabelled absence/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockApi.post).toHaveBeenCalledWith('/teams/t-1/holiday-cleanup', { absence_ids: ['a-3', 'a-4'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['absences', 't-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['holidayCleanup'] })
  })

  it('sends every member of every ticked group', async () => {
    const { user, onClose } = setup()
    await user.click(await screen.findByRole('checkbox', { name: /Christmas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Unlabelled absence/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith('/teams/t-1/holiday-cleanup', { absence_ids: ['a-1', 'a-2', 'a-3', 'a-4'] })
  })

  it('unticks a group on a second click, and disables the delete again', async () => {
    const { user } = setup()
    const christmas = await screen.findByRole('checkbox', { name: /Christmas/ })
    await user.click(christmas)
    expect(christmas).toBeChecked()
    expect(screen.getByRole('button', { name: 'Delete ticked' })).toBeEnabled()
    await user.click(christmas)
    expect(christmas).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Delete ticked' })).toBeDisabled()
  })

  it('says so when there is nothing to tidy', async () => {
    setup({ groups: [] })
    expect(await screen.findByText('No duplicates found.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete ticked' })).toBeDisabled()
  })

  it("stays open with the server's reason when the delete fails", async () => {
    const { user, onClose } = setup()
    mockApi.post.mockRejectedValueOnce(apiError('a-1 is not a duplicate any more'))
    await user.click(await screen.findByRole('checkbox', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('a-1 is not a duplicate any more')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Christmas/ })).toBeChecked()
  })

  it('falls back to a generic message, and clears it on retry', async () => {
    const { user, onClose } = setup()
    mockApi.post.mockRejectedValueOnce(new Error('Network Error'))
    await user.click(await screen.findByRole('checkbox', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete those absences — please try again.')

    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the delete while it is being sent', async () => {
    const { user } = setup()
    mockApi.post.mockImplementation(() => new Promise(() => undefined))
    await user.click(await screen.findByRole('checkbox', { name: /Christmas/ }))
    const remove = screen.getByRole('button', { name: 'Delete ticked' })
    await user.click(remove)
    await waitFor(() => expect(remove).toBeDisabled())
  })

  it('closes on Cancel and on Escape, forgetting the ticks and the error', async () => {
    const { user, onClose, rerender } = setup()
    mockApi.post.mockRejectedValueOnce(new Error('x'))
    await user.click(await screen.findByRole('checkbox', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ticked' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(false)
    rerender(true)
    expect(await screen.findByRole('checkbox', { name: /Christmas/ })).not.toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('looks for nothing while closed', () => {
    setup({ groups: GROUPS }, false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.get).not.toHaveBeenCalled()
  })
})
