import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClearBacklogModal } from '../ClearBacklogModal'
import * as useFeatureHooks from '@/hooks/useFeatures'

vi.mock('@/hooks/useFeatures')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const clearBacklogMutateAsync = vi.fn()
const clearAllMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useFeatureHooks.useClearBacklog).mockReturnValue({
    mutateAsync: clearBacklogMutateAsync.mockResolvedValue({ deleted_features: 2 }),
    isPending: false,
  } as ReturnType<typeof useFeatureHooks.useClearBacklog>)
  vi.mocked(useFeatureHooks.useClearAllFeatures).mockReturnValue({
    mutateAsync: clearAllMutateAsync.mockResolvedValue({ deleted_features: 5 }),
    isPending: false,
  } as ReturnType<typeof useFeatureHooks.useClearAllFeatures>)
})

const defaultProps = {
  open: true,
  projectId: 'proj-1',
  backlogCount: 2,
  totalCount: 5,
  onClose: vi.fn(),
}

describe('ClearBacklogModal', () => {
  it('renders both options with correct counts', () => {
    render(<ClearBacklogModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText(/Backlog only/)).toBeInTheDocument()
    expect(screen.getByText(/\(2 features\)/)).toBeInTheDocument()
    expect(screen.getByText(/Everything/)).toBeInTheDocument()
    expect(screen.getByText(/\(5 features\)/)).toBeInTheDocument()
  })

  it('has "Backlog only" pre-selected', () => {
    render(<ClearBacklogModal {...defaultProps} />, { wrapper: makeWrapper() })
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toBeChecked()
    expect(radios[1]).not.toBeChecked()
  })

  it('Delete button is enabled on initial render', () => {
    render(<ClearBacklogModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('Cancel calls onClose without any mutation', async () => {
    const onClose = vi.fn()
    render(<ClearBacklogModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(clearBacklogMutateAsync).not.toHaveBeenCalled()
    expect(clearAllMutateAsync).not.toHaveBeenCalled()
  })

  it('Delete with "Backlog only" calls clearBacklog mutation', async () => {
    const onClose = vi.fn()
    render(<ClearBacklogModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(clearBacklogMutateAsync).toHaveBeenCalledTimes(1)
    expect(clearAllMutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Delete with "Everything" calls clearAll mutation', async () => {
    const onClose = vi.fn()
    render(<ClearBacklogModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getAllByRole('radio')[1])
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(clearAllMutateAsync).toHaveBeenCalledTimes(1)
    expect(clearBacklogMutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render when closed', () => {
    render(<ClearBacklogModal {...defaultProps} open={false} />, { wrapper: makeWrapper() })
    expect(screen.queryByText('Clear features')).not.toBeInTheDocument()
  })
})
