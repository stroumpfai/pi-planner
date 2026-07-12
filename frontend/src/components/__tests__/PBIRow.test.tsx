import { vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIRow } from '../PBIRow'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import * as pbisService from '@/services/pbis'
import type { PBI } from '@/types'

vi.mock('@/services/pbis', () => ({
  pbisApi: { update: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]) },
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

beforeEach(() => {
  useAuthStore.setState({ user: null, isEditing: false })
  useSettingsStore.setState({ showEffortUnit: true })
})

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

  it('title is plain text, not a click-to-edit control', async () => {
    useAuthStore.setState({ isEditing: true })
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    // The title is no longer a button/input — clicking it does nothing.
    expect(screen.queryByRole('button', { name: 'Login UI' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Login UI'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('clicking Edit button opens the PBIFormModal', async () => {
    useAuthStore.setState({ isEditing: true })
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('clicking Delete button shows the confirm dialog', async () => {
    useAuthStore.setState({ isEditing: true })
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText('Delete PBI')).toBeInTheDocument()
  })

  it('confirming Delete calls pbisApi.delete', async () => {
    useAuthStore.setState({ isEditing: true })
    render(<PBIRow pbi={basePBI} projectId="proj-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
    await waitFor(() =>
      expect(pbisService.pbisApi.delete).toHaveBeenCalledWith('p-1'),
    )
  })
})
