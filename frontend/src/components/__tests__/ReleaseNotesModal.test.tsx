import { vi, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('renders each section as a heading with its bullets', async () => {
    const data: ReleaseNotes = {
      entries: [
        { version: 'Unreleased', date: null, notes: ['Teams can now be exported to and imported from JSON'] },
        { version: '1.13.0', date: '2026-08-14', notes: ['Add a team Achievement view'] },
      ],
    }
    mockApi.get.mockResolvedValue({ data, headers: {} })
    open()

    expect(await screen.findByText('Unreleased')).toBeInTheDocument()
    expect(screen.getByText('Teams can now be exported to and imported from JSON')).toBeInTheDocument()
    expect(screen.getByText('1.13.0')).toBeInTheDocument()
    expect(screen.getByText('2026-08-14')).toBeInTheDocument()
    expect(screen.getByText('Add a team Achievement view')).toBeInTheDocument()
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
