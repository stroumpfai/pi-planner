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
  work_item_path_template: null,
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
      work_item_path_template: null,
      effort_unit: 'pts',
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
      work_item_path_template: null,
      effort_unit: 'pts',
    })
  })
})

describe('EditProjectModal — effort unit', () => {
  const onClose = vi.fn()
  beforeEach(() => vi.clearAllMocks())

  it('shows the current effort unit in the input', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    const withUnit = { ...project, effort_unit: 'sp' }
    render(<EditProjectModal open project={withUnit} onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByLabelText('Effort unit')).toHaveValue('sp'))
  })

  it('sends the changed effort unit on save', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    const input = screen.getByLabelText('Effort unit')
    await waitFor(() => expect(input).toHaveValue('pts'))
    await userEvent.clear(input)
    await userEvent.type(input, 'sp')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith('proj-1', expect.objectContaining({ effort_unit: 'sp' }))
  })

  it('falls back to pts when the effort unit is cleared', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    const withUnit = { ...project, effort_unit: 'sp' }
    render(<EditProjectModal open project={withUnit} onClose={onClose} />, { wrapper: makeWrapper() })
    const input = screen.getByLabelText('Effort unit')
    await waitFor(() => expect(input).toHaveValue('sp'))
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith('proj-1', expect.objectContaining({ effort_unit: 'pts' }))
  })
})

describe('EditProjectModal — work-item links', () => {
  const onClose = vi.fn()
  beforeEach(() => vi.clearAllMocks())

  it('sends the Azure DevOps template when that preset is selected', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByLabelText(/work-item links/i), 'azure_devops')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ work_item_path_template: '_workitems/edit/{id}' }),
    )
  })

  it('sends the Jira template when that preset is selected', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByLabelText(/work-item links/i), 'jira')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.update).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ work_item_path_template: 'browse/{id}' }),
    )
  })

  it('preselects the matching preset from the stored template', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    const withTemplate = { ...project, work_item_path_template: 'browse/{id}' }
    render(<EditProjectModal open project={withTemplate} onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByLabelText(/work-item links/i)).toHaveValue('jira')
  })

  it('rejects a custom template without {id}', async () => {
    mockApi.update = vi.fn().mockResolvedValue(project)
    render(<EditProjectModal open project={project} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByLabelText(/work-item links/i), 'custom')
    await userEvent.type(screen.getByPlaceholderText('_workitems/edit/{id}'), '_workitems/edit/1')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/must contain the \{id\} placeholder/i)).toBeInTheDocument())
    expect(mockApi.update).not.toHaveBeenCalled()
  })
})
