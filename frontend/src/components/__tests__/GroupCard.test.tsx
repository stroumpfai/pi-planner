import { vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext } from '@dnd-kit/core'
import { GroupCard } from '../GroupCard'
import { useAuthStore } from '@/stores/authStore'
import * as pbisService from '@/services/pbis'
import * as groupsService from '@/services/groups'
import * as featuresService from '@/services/features'
import type { Group, PBI } from '@/types'

vi.mock('@/services/pbis')
vi.mock('@/services/groups')
vi.mock('@/services/features')

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
  item_type: 'story',
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
  vi.mocked(featuresService.featuresApi).list = vi.fn().mockResolvedValue([])
})

describe('GroupCard', () => {
  it('renders group name', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('Auth Group')).toBeInTheDocument()
  })

  it('shows effort total from grouped PBIs', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([
      makePBI({ system_id: 'pbi-1', effort: 5 }),
      makePBI({ system_id: 'pbi-2', effort: 3 }),
    ])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    const badge = await screen.findByText('8pts')
    expect(badge.className).toContain('bg-amber-100')
    expect(badge.className).toContain('text-amber-700')
  })

  it('keeps the gray effort pill and Bug badge on each PBI/Bug once placed in a sprint', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([
      makePBI({ system_id: 'pbi-1', item_type: 'bug', effort: 2, title: 'Crash on save' }),
      makePBI({ system_id: 'pbi-2', item_type: 'story', effort: 5, title: 'Login flow' }),
    ])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Crash on save')).toBeInTheDocument())

    expect(screen.getByText('Bug')).toBeInTheDocument()

    const bugEffort = screen.getByText('2pts')
    expect(bugEffort.className).toContain('bg-band')
    expect(bugEffort.className).toContain('text-gray-500')

    const storyEffort = screen.getByText('5pts')
    expect(storyEffort.className).toContain('bg-band')
    expect(storyEffort.className).toContain('text-gray-500')
  })

  it('lists PBI titles', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([makePBI()])
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Login flow')).toBeInTheDocument())
  })

  it('sprint selector shows correct sprint in edit mode', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup({ sprint_index: 1 })} projectId="p-1" />, { wrapper: makeWrapper() })
    const selector = screen.getByTitle('Move to sprint') as HTMLSelectElement
    expect(selector.value).toBe('1')
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

  it('changing sprint selector calls update mutation with new sprint index', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByTitle('Move to sprint'), '2')
    expect(groupsService.groupsApi.update).toHaveBeenCalledWith('g-1', { sprint_index: 2 })
  })

  it('clicking rename button starts renaming and shows an input', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    // Use fireEvent.click to avoid dnd-kit pointer listener interference inside drag handle
    fireEvent.click(screen.getByTitle('Rename group'))
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('typing a new name and pressing Enter calls update mutation', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    fireEvent.click(screen.getByTitle('Rename group'))
    const input = await screen.findByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed{Enter}')
    expect(groupsService.groupsApi.update).toHaveBeenCalledWith('g-1', { name: 'Renamed' })
  })

  it('clicking PBI title in edit mode starts inline editing', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([makePBI()])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Login flow'))
    // fireEvent avoids dnd-kit pointer listener interference inside the drag handle
    fireEvent.click(screen.getByText('Login flow'))
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('pressing Enter on inline PBI title calls submit and closes the input', async () => {
    vi.mocked(pbisService.pbisApi).list = vi.fn().mockResolvedValue([makePBI()])
    useAuthStore.setState({ isEditing: true })
    render(<GroupCard group={makeGroup()} projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Login flow'))
    fireEvent.click(screen.getByText('Login flow'))
    const input = await screen.findByRole('textbox')
    await userEvent.type(input, '{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })
})
