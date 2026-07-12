import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateProjectModal } from '../CreateProjectModal'
import * as projectsService from '@/services/projects'

vi.mock('@/services/projects')
const mockApi = vi.mocked(projectsService.projectsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('CreateProjectModal', () => {
  const onClose = vi.fn()
  beforeEach(() => vi.clearAllMocks())

  it('renders when open', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New Project')).toBeInTheDocument()
  })

  it('shows validation error when name is empty', async () => {
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeInTheDocument())
  })

  it('calls create API and closes on success', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'new', name: 'Test', description: null, created_at: '', modified_at: '' })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Test')
    await userEvent.click(screen.getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.create).toHaveBeenCalledWith({ name: 'Test', description: null, azure_devops_url: null })
  })

  it('sends a valid Azure DevOps URL on create', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'new', name: 'Test', description: null, azure_devops_url: null, created_at: '', modified_at: '' })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Test')
    await userEvent.type(screen.getByLabelText(/azure devops url/i), 'https://dev.azure.com/org/proj')
    await userEvent.click(screen.getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.create).toHaveBeenCalledWith({
      name: 'Test',
      description: null,
      azure_devops_url: 'https://dev.azure.com/org/proj',
    })
  })

  it('rejects a javascript: URL and does not call the API', async () => {
    mockApi.create = vi.fn()
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Test')
    await userEvent.type(screen.getByLabelText(/azure devops url/i), 'javascript:alert(1)')
    await userEvent.click(screen.getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(screen.getByText(/must be an http\(s\):\/\/ url/i)).toBeInTheDocument())
    expect(mockApi.create).not.toHaveBeenCalled()
  })

  it('shows duplicate name error on 409', async () => {
    const err = { response: { status: 409 } }
    mockApi.create = vi.fn().mockRejectedValue(err)
    render(<CreateProjectModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Dup')
    await userEvent.click(screen.getByRole('button', { name: /create project/i }))
    await waitFor(() =>
      expect(screen.getByText('A project with this name already exists')).toBeInTheDocument()
    )
  })
})
