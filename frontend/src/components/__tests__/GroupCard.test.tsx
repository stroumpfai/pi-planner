import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext } from '@dnd-kit/core'
import { GroupCard } from '../GroupCard'
import { useAuthStore } from '@/stores/authStore'
import * as pbisService from '@/services/pbis'
import * as groupsService from '@/services/groups'
import type { Group, PBI } from '@/types'

vi.mock('@/services/pbis')
vi.mock('@/services/groups')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <DndContext>{children}</DndContext>
    </QueryClientProvider>
  )
}

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  system_id: 'g-1',
  swimline_id: 'sw-1',
  feature_system_id: 'f-1',
  name: 'Auth Group',
  sprint_index: null,
  order_index: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const makePBI = (overrides: Partial<PBI> = {}): PBI => ({
  system_id: 'pbi-1',
  project_id: 'p-1',
  id: null,
  parent_feature_system_id: 'f-1',
  title: 'Login flow',
  description: null,
  effort: 3,
  location: 'pi',
  pi_id: 'pi-1',
  swimlane_id: 'sw-1',
  group_id: 'g-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
  vi.mocked(groupsService.groupsApi).update = vi.fn().mockResolvedValue({})
  vi.mocked(groupsService.groupsApi).delete = vi.fn().mockResolvedValue({})
})

describe('GroupCard', () => {
  it('renders group name', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('Auth Group')).toBeInTheDocument()
  })

  it('shows effort total from grouped PBIs', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([makePBI({ effort: 5 })])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('5pt')).toBeInTheDocument())
  })

  it('lists PBI titles', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([makePBI()])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Login flow')).toBeInTheDocument())
  })

  it('shows sprint badge when sprint assigned', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    render(<GroupCard group={makeGroup({ sprint_index: 1 })} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('S2')).toBeInTheDocument()
  })

  it('hides Ungroup button when not in edit mode', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: false })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.queryByTitle('Ungroup (PBIs remain)')).not.toBeInTheDocument()
  })

  it('shows Ungroup button in edit mode and calls delete on click', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByTitle('Ungroup (PBIs remain)'))
    expect(groupsService.groupsApi.delete).toHaveBeenCalledWith('g-1')
  })
})
