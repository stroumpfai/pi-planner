import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  continued_from_feature_id: null,
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
    await waitFor(() => expect(screen.getByText('5pts')).toBeInTheDocument())
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

  it('shows total effort in header', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature()])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('5 pts')).toBeInTheDocument())
  })

  it('sums effort across multiple features', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([
      makeFeature({ effort: 5 }),
      makeFeature({ system_id: 'f-2', effort: 10 }),
    ])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('15 pts')).toBeInTheDocument())
  })

  it('omits effort badge when total effort is zero', async () => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([makeFeature({ effort: 0 })])
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    // Header should not show the total-effort span (which uses a space before the unit)
    expect(screen.queryByText(/^0 pts$/)).not.toBeInTheDocument()
  })
})

describe('BacklogPanel search', () => {
  const mockList = (features: Feature[]) => {
    vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue(features)
  }

  const twoFeatures = () => [
    makeFeature({ system_id: 'f-1', id: 101, title: 'Auth' }),
    makeFeature({ system_id: 'f-2', id: 202, title: 'Billing' }),
  ]

  /** Renders and waits for the features query to settle, so typing never races the fetch. */
  const renderPanel = async (firstTitle = 'Auth') => {
    render(<BacklogPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(firstTitle)).toBeInTheDocument())
  }

  const openSearch = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Search backlog' }))
    return screen.getByRole('searchbox', { name: /search backlog by id or title/i })
  }

  it('renders the search toggle without an input', async () => {
    mockList(twoFeatures())
    await renderPanel()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('reveals and focuses the input when the magnifier is clicked', async () => {
    mockList(twoFeatures())
    await renderPanel()
    const input = await openSearch()
    expect(input).toHaveFocus()
  })

  it('filters the list by a title substring', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), 'bill')
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
  })

  it('filters the list by user id', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), '202')
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
  })

  it('matches case-insensitively', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), 'AUTH')
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.queryByText('Billing')).not.toBeInTheDocument()
  })

  it('shows matched/total in the count badge while filtering', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), 'auth')
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows No matches when nothing matches', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), 'zzz')
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
    expect(screen.getByText('0/2')).toBeInTheDocument()
  })

  it('closes and clears the filter on Escape', async () => {
    mockList(twoFeatures())
    await renderPanel()
    const input = await openSearch()
    await userEvent.type(input, 'auth')
    await userEvent.type(input, '{Escape}')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
  })

  it('closes and clears the filter when the magnifier is clicked again', async () => {
    mockList(twoFeatures())
    await renderPanel()
    await userEvent.type(await openSearch(), 'auth')
    await userEvent.click(screen.getByRole('button', { name: 'Close backlog search' }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('never surfaces features that are already in a PI', async () => {
    mockList([
      makeFeature({ system_id: 'f-1', id: 101, title: 'Auth' }),
      makeFeature({ system_id: 'f-3', id: 303, title: 'Auth reporting', location: 'pi', swimlane_id: 'sw-1' }),
    ])
    await renderPanel()
    await userEvent.type(await openSearch(), 'auth')
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.queryByText('Auth reporting')).not.toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})
