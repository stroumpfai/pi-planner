import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIFormModal } from '../PBIFormModal'
import type { PBI } from '@/types'

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const onSubmit = vi.fn()
const onClose = vi.fn()

const basePBI: PBI = {
  system_id: 'pbi-1',
  id: null,
  title: 'Login form',
  description: null,
  effort: null,
  item_type: 'story',
  location: 'backlog',
  pi_id: null,
  swimlane_id: null,
  group_id: null,
  project_id: 'p-1',
  parent_feature_system_id: 'f-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const defaultProps = { open: true, onClose, onSubmit }

beforeEach(() => vi.clearAllMocks())

describe('PBIFormModal', () => {
  it('renders "New story" title for a create modal', () => {
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New story')).toBeInTheDocument()
  })

  it('renders "Edit PBI" title when editing an existing PBI', () => {
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    expect(screen.getByText(/edit pbi/i)).toBeInTheDocument()
  })

  it('pre-fills title field when editing', () => {
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    expect(screen.getByLabelText(/title/i)).toHaveValue('Login form')
  })

  it('clicking Bug toggle changes the type label to Bug', async () => {
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /bug/i }))
    expect(screen.getByRole('button', { name: /create bug/i })).toBeInTheDocument()
  })

  it('submitting calls onSubmit with form values', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/title/i), 'New PBI')
    await userEvent.click(screen.getByRole('button', { name: /create pbi/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New PBI', item_type: 'story' }),
      ),
    )
  })

  it('Cancel button calls onClose', async () => {
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows duplicate-ID error on 409 response', async () => {
    onSubmit.mockRejectedValue({
      response: { status: 409, data: { detail: { error: 'ID_ALREADY_EXISTS' } } },
    })
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(screen.getByText(/already used in this project/i)).toBeInTheDocument(),
    )
  })
})
