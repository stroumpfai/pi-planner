import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIRow } from '../PBIRow'
import { useAuthStore } from '@/stores/authStore'
import type { PBI } from '@/types'

vi.mock('@/services/pbis', () => ({
  pbisApi: { update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]) },
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const basePBI: PBI = {
  system_id: 'p-1',
  id: null,
  title: 'Login UI',
  description: null,
  effort: null,
  item_type: 'story',
  location: 'backlog',
  pi_id: null,
  swimlane_id: null,
  group_id: null,
  project_id: 'proj-1',
  parent_feature_system_id: 'feat-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => useAuthStore.setState({ user: null, isEditing: false }))

describe('PBIRow', () => {
  it('shows title without prefix when id is null', () => {
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('Login UI')).toBeInTheDocument()
    expect(screen.queryByText(/\[/)).not.toBeInTheDocument()
  })

  it('shows [102] prefix when id is set', () => {
    render(<PBIRow pbi={{ ...basePBI, id: 102 }} projectId="proj-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText(/\[102\]/)).toBeInTheDocument()
  })

  it('shows effort badge', () => {
    render(<PBIRow pbi={{ ...basePBI, effort: 5 }} projectId="proj-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('5pts')).toBeInTheDocument()
  })

  it('edit and delete buttons disabled when not editing', () => {
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /edit/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('edit and delete buttons enabled in edit mode', () => {
    useAuthStore.setState({ isEditing: true })
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /edit/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
  })
})
