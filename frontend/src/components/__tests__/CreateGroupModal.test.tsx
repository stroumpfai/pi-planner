import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateGroupModal } from '../CreateGroupModal'
import { useCreateGroup } from '@/hooks/useSwimlinesAndGroups'

vi.mock('@/hooks/useSwimlinesAndGroups')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const defaultProps = {
  open: true,
  swimlaneId: 'sw-1',
  featureId: 'f-1',
  pbiIds: [],
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCreateGroup).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as ReturnType<typeof useCreateGroup>)
})

describe('CreateGroupModal', () => {
  it('renders the New Group title when open', () => {
    render(<CreateGroupModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New Group')).toBeInTheDocument()
  })

  it('shows PBI count when pbiIds are provided', () => {
    render(<CreateGroupModal {...defaultProps} pbiIds={['p-1', 'p-2']} />, { wrapper: makeWrapper() })
    expect(screen.getByText(/2 PBIs will be added/i)).toBeInTheDocument()
  })

  it('Create button is disabled when name is empty', () => {
    render(<CreateGroupModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
  })

  it('Create button is enabled when name is typed', async () => {
    render(<CreateGroupModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Sprint Group')
    expect(screen.getByRole('button', { name: /^create$/i })).not.toBeDisabled()
  })

  it('submitting calls mutateAsync with the group name', async () => {
    mutateAsync.mockResolvedValue({})
    render(<CreateGroupModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Sprint Group')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sprint Group', feature_system_id: 'f-1' }),
    )
  })

  it('shows error message on mutation failure', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { message: 'Name already taken' } } },
    })
    render(<CreateGroupModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Duplicate')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(screen.getByText('Name already taken')).toBeInTheDocument())
  })
})
