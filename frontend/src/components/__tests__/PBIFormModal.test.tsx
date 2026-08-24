import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIFormModal } from '../PBIFormModal'
import { useStatesForType } from '@/hooks/useStates'
import type { PBI, ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

// Every test here renders the modal, and the modal renders StateSelect.
beforeEach(() => {
  vi.mocked(useStatesForType).mockImplementation((_projectId, itemType) => ({
    states: [makeState('Committed', itemType), makeState('Done', itemType)],
  } as ReturnType<typeof useStatesForType>))
})

const makeState = (value: string, itemType: StateItemType): ProjectState => ({
  system_id: `st-${value}`,
  project_id: 'p-1',
  item_type: itemType,
  value,
  position: 0,
  category: null,
  created_at: '2026-01-01T00:00:00Z',
})

vi.mock('@/hooks/useProjects', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useProjects')>('@/hooks/useProjects')
  return {
    ...actual,
    useProject: () => ({
      data: {
        azure_devops_url: 'https://dev.azure.com/acme/proj',
        work_item_path_template: '_workitems/edit/{id}',
      },
    }),
  }
})

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

beforeEach(() => {
  vi.clearAllMocks()
})

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

  // ── Effort button-group ──────────────────────────────────────────────────────

  it('renders effort button-group with clear and all allowed value buttons', () => {
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: '—' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '½' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '21' })).toBeInTheDocument()
  })

  it('selecting effort=0 submits 0, not null', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/title/i), 'Zero story')
    await userEvent.click(screen.getByRole('button', { name: '0' }))
    await userEvent.click(screen.getByRole('button', { name: /create pbi/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ effort: 0 }),
      ),
    )
  })

  it('selecting effort=0.5 submits 0.5', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/title/i), 'Half story')
    await userEvent.click(screen.getByRole('button', { name: '½' }))
    await userEvent.click(screen.getByRole('button', { name: /create pbi/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ effort: 0.5 }),
      ),
    )
  })

  it('pre-selects the active effort button when editing a PBI with effort=0.5', () => {
    const halfPBI: PBI = { ...basePBI, effort: 0.5 }
    render(<PBIFormModal {...defaultProps} pbi={halfPBI} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: '½' })).toHaveClass('bg-blue-600')
  })

  it('clear button (—) deselects effort and submits null', async () => {
    onSubmit.mockResolvedValue(undefined)
    const pbiWithEffort: PBI = { ...basePBI, effort: 5 }
    render(<PBIFormModal {...defaultProps} pbi={pbiWithEffort} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: '—' }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ effort: null }),
      ),
    )
  })

  // ── Read-only mode ───────────────────────────────────────────────────────────

  it('read-only mode disables fields and hides the save button', () => {
    render(<PBIFormModal {...defaultProps} pbi={basePBI} readOnly />, { wrapper: makeWrapper() })
    expect(screen.getByText(/details/i)).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/title/i)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('read-only mode still exposes the work-item copy link', () => {
    const linkedPBI: PBI = { ...basePBI, id: 42 }
    render(<PBIFormModal {...defaultProps} pbi={linkedPBI} readOnly />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /copy work-item link/i })).toBeEnabled()
  })
})

describe('PBIFormModal State field', () => {
  it('pre-fills the State when editing', () => {
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('state-select')).toHaveValue('st-Committed')
  })

  it('starts blank when the item has no State', () => {
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    expect(screen.getByTestId('state-select')).toHaveValue('')
  })

  it('submits the chosen State as state_id', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Done')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ state_id: 'st-Done' })),
    )
  })

  it('submits null when the State is cleared', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )

    await userEvent.selectOptions(screen.getByTestId('state-select'), '')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ state_id: null })),
    )
  })

  it('clears the State when switching between PBI and Bug', async () => {
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('state-select')).toHaveValue('st-Committed')

    await userEvent.click(screen.getByRole('button', { name: /^bug$/i }))
    expect(screen.getByTestId('state-select')).toHaveValue('')
  })

  it('keeps the State when the type toggle is clicked for the current type', async () => {
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )
    await userEvent.click(screen.getByRole('button', { name: /^pbi$/i }))
    expect(screen.getByTestId('state-select')).toHaveValue('st-Committed')
  })
})
