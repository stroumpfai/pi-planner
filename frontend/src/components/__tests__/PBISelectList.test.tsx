import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext } from '@dnd-kit/core'
import { PBISelectList } from '../PBISelectList'
import { useAuthStore } from '@/stores/authStore'
import * as pbisService from '@/services/pbis'
import type { PBI } from '@/types'

vi.mock('@/services/pbis')
const mockApi = vi.mocked(pbisService.pbisApi)

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <DndContext>{children}</DndContext>
    </QueryClientProvider>
  )
}

const makePBI = (overrides: Partial<PBI> = {}): PBI => ({
  system_id: 'pbi-1',
  id: null,
  title: 'Login form',
  item_type: 'story',
  effort: null,
  group_id: null,
  parent_feature_system_id: 'f-1',
  project_id: 'p-1',
  sprint_index: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const defaultProps = {
  featureId: 'f-1',
  projectId: 'p-1',
  selectedIds: new Set<string>(),
  onToggle: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('PBISelectList', () => {
  it('shows "No PBIs" when the list is empty', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/no pbis/i)).toBeInTheDocument())
  })

  it('renders a checkbox for each PBI', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI(), makePBI({ system_id: 'pbi-2', title: 'Sign up' })])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Login form')).toBeInTheDocument())
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('renders a selected PBI with its checkbox checked', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI()])
    render(
      <PBISelectList {...defaultProps} selectedIds={new Set(['pbi-1'])} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('calls onToggle with the PBI id when checkbox is clicked', async () => {
    const onToggle = vi.fn()
    mockApi.list = vi.fn().mockResolvedValue([makePBI()])
    render(
      <PBISelectList {...defaultProps} onToggle={onToggle} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('pbi-1')
  })

  it('renders a Bug label for bug-type PBIs', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI({ item_type: 'bug', title: 'Crash on login' })])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Crash on login'))
    expect(screen.getByText('Bug')).toBeInTheDocument()
  })

  it('shows effort with the project effort-unit suffix, like the Backlog view', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI({ effort: 5 })])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    const badge = await screen.findByText('5pts')
    expect(badge.className).toContain('bg-gray-100')
    expect(badge.className).toContain('text-gray-500')
  })

  it('omits the effort badge when effort is null', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI({ effort: null })])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Login form'))
    expect(screen.queryByText(/^\d+pts?$/)).not.toBeInTheDocument()
  })

  it('Edit button opens the PBI edit modal in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([makePBI()])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Login form'))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('Edit pen is not shown when not in edit mode', async () => {
    mockApi.list = vi.fn().mockResolvedValue([makePBI()])
    render(<PBISelectList {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Login form'))
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
