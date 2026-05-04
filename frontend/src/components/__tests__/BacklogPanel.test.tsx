import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext } from '@dnd-kit/core'
import { BacklogPanel } from '../BacklogPanel'
import * as featuresService from '@/services/features'
import type { Feature } from '@/types'

vi.mock('@/services/features')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <DndContext>{children}</DndContext>
    </QueryClientProvider>
  )
}

const makeFeature = (overrides: Partial<Feature> = {}): Feature => ({
  system_id: 'f-1',
  project_id: 'p-1',
  id: 101,
  title: 'Auth',
  description: null,
  effort: 5,
  location: 'backlog',
  pi_id: null,
  swimlane_id: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BacklogPanel', () => {
  it('shows count of backlog features', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature()])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('renders feature title', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature()])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Auth')).toBeInTheDocument())
  })

  it('renders effort badge', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature()])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('5pt')).toBeInTheDocument())
  })

  it('shows [id] prefix when feature has user id', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature({ id: 42 })])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/\[42\]/)).toBeInTheDocument())
  })

  it('shows Empty when no backlog features', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Empty')).toBeInTheDocument())
  })

  it('filters out non-backlog features', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([
      makeFeature({ location: 'pi', swimlane_id: 'sw-1' }),
    ])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
  })
})
