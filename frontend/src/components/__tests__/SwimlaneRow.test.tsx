import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SwimlaneRow } from '../SwimlaneRow'
import { useAuthStore } from '@/stores/authStore'
import * as swimlineService from '@/services/swimlines'
import * as featureService from '@/services/features'
import type { Feature, Sprint, Swimline } from '@/types'

vi.mock('@/services/swimlines')
vi.mock('@/services/features')
vi.mock('@/services/pbis', () => ({ pbisApi: { list: vi.fn().mockResolvedValue([]) } }))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const makeSwimlane = (): Swimline => ({
  system_id: 'sw-1',
  pi_id: 'pi-1',
  name: 'Team Alpha',
  order_index: 1,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
})

const makeSprint = (index: number): Sprint => ({
  system_id: `s-${index}`,
  pi_id: 'pi-1',
  sprint_index: index,
  capacity: 10,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
})

const makeFeature = (overrides: Partial<Feature> = {}): Feature => ({
  system_id: 'f-1',
  project_id: 'p-1',
  id: null,
  title: 'Auth Feature',
  description: null,
  effort: null,
  location: 'pi',
  pi_id: 'pi-1',
  swimlane_id: 'sw-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
  vi.mocked(swimlineService.swimlinesApi).delete = vi.fn().mockResolvedValue({})
  vi.mocked(featureService.featuresApi).list = vi.fn().mockResolvedValue([])
})

describe('SwimlaneRow', () => {
  it('renders swimlane name', () => {
    render(
      <SwimlaneRow
        swimline={makeSwimlane()}
        sprints={[makeSprint(0), makeSprint(1)]}
        features={[]}
        projectId="p-1"
        piId="pi-1"
      />,
      { wrapper: makeWrapper() }
    )
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()
  })

  it('collapses on toggle click', async () => {
    render(
      <SwimlaneRow
        swimline={makeSwimlane()}
        sprints={[makeSprint(0)]}
        features={[]}
        projectId="p-1"
        piId="pi-1"
      />,
      { wrapper: makeWrapper() }
    )
    expect(screen.getByText('Features')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Collapse swimlane'))
    expect(screen.queryByText('Features')).not.toBeInTheDocument()
  })

  it('shows feature count chip', () => {
    const feature = makeFeature()
    render(
      <SwimlaneRow
        swimline={makeSwimlane()}
        sprints={[]}
        features={[feature]}
        projectId="p-1"
        piId="pi-1"
      />,
      { wrapper: makeWrapper() }
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('hides delete button when not in edit mode', () => {
    useAuthStore.setState({ isEditing: false })
    render(
      <SwimlaneRow
        swimline={makeSwimlane()}
        sprints={[]}
        features={[]}
        projectId="p-1"
        piId="pi-1"
      />,
      { wrapper: makeWrapper() }
    )
    expect(screen.queryByTitle('Delete swimlane')).not.toBeInTheDocument()
  })

  it('shows delete confirmation when delete clicked in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    render(
      <SwimlaneRow
        swimline={makeSwimlane()}
        sprints={[]}
        features={[]}
        projectId="p-1"
        piId="pi-1"
      />,
      { wrapper: makeWrapper() }
    )
    await userEvent.click(screen.getByTitle('Delete swimlane'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })
})
