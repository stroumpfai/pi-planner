import { vi, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReleaseNotesModal } from '../ReleaseNotesModal'
import * as apiModule from '@/services/api'
import type { ReleaseNotes } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function open(onClose = vi.fn()) {
  return render(<ReleaseNotesModal open onClose={onClose} />, { wrapper: wrapper() })
}

describe('ReleaseNotesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the newest version, collapses older ones, and expands on click', async () => {
    const data: ReleaseNotes = {
      entries: [
        {
          version: '1.14.0',
          date: '2026-10-11',
          groups: [{ title: 'Teams', items: [{ text: 'Export teams to JSON' }] }],
        },
        { version: '1.13.0', date: '2026-09-26', groups: [{ title: null, items: [{ text: 'Add a team Achievement view' }] }] },
      ],
    }
    mockApi.get.mockResolvedValue({ data, headers: {} })
    open()

    expect(await screen.findByText('Export teams to JSON')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeInTheDocument()
    expect(screen.queryByText('Add a team Achievement view')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /1\.13\.0/ }))
    expect(screen.getByText('Add a team Achievement view')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /1\.14\.0/ }))
    expect(screen.queryByText('Export teams to JSON')).not.toBeInTheDocument()
  })

  it('keeps nested bullets nested', async () => {
    const data: ReleaseNotes = {
      entries: [
        {
          version: '1.14.0',
          date: null,
          groups: [{ title: null, items: [{ text: 'Alpha', children: [{ text: 'Beta', children: [{ text: 'Gamma' }] }] }] }],
        },
      ],
    }
    mockApi.get.mockResolvedValue({ data, headers: {} })
    open()

    const grandchild = await screen.findByText('Gamma')
    const child = screen.getByText('Beta', { exact: false })
    expect(child.closest('li')?.querySelector('ul')).toContainElement(grandchild)
    expect(screen.getByText('Alpha', { exact: false }).closest('li')?.querySelector('ul')).toContainElement(child)
  })

  it('shows an empty state when there are no entries yet', async () => {
    mockApi.get.mockResolvedValue({ data: { entries: [] }, headers: {} })
    open()

    expect(await screen.findByText('No release notes yet.')).toBeInTheDocument()
  })

  it('does not fetch until open', () => {
    mockApi.get.mockResolvedValue({ data: { entries: [] }, headers: {} })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ReleaseNotesModal open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(mockApi.get).not.toHaveBeenCalled()
  })
})
