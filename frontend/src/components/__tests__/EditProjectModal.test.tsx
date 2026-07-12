import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditProjectModal } from '../EditProjectModal'
import * as projectsService from '@/services/projects'
import type { Project } from '@/types'

vi.mock('@/services/projects')
const mockApi = vi.mocked(projectsService.projectsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const project: Project = {
  system_id: 'proj-1',
  name: 'My Project',
  description: 'Desc',
  azure_devops_url: null,
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

describe('EditProjectModal — Azure DevOps URL', () => {
  const onClose = vi.fn()
  beforeEach(() => vi.clearAllMocks())

  it('sends a valid https URL on save', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/azure devops url/i), 'https://dev.azure.com/org/proj')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith('proj-1', {
      name: 'My Project',
      description: 'Desc',
      azure_devops_url: 'https://dev.azure.com/org/proj',
    })
  })

  it('rejects a javascript: URL and does not call the API', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/azure devops url/i), 'javascript:alert(1)')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/must be an http\(s\):\/\/ url/i)).toBeInTheDocument())
    expect(mockApi.update).not.toHaveBeenCalled()
  })

  it('sends null when the URL field is cleared', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    const withUrl = { ...project, azure_devops_url: 'https://dev.azure.com/org/proj' }
    render(<EditProjectModal open project={withUrl} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.clear(screen.getByLabelText(/azure devops url/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith('proj-1', {
      name: 'My Project',
      description: 'Desc',
      azure_devops_url: null,
    })
  })
})
