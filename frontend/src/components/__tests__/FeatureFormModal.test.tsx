import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeatureFormModal } from '../FeatureFormModal'
import { useStatesForType } from '@/hooks/useStates'
import type { Feature, ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

const makeState = (value: string, itemType: StateItemType): ProjectState => ({
  system_id: `st-${value}`,
  project_id: 'p-1',
  item_type: itemType,
  value,
  position: 0,
  category: null,
  created_at: '2026-01-01T00:00:00Z',
})

// Every test renders the modal, and the modal renders StateSelect.
beforeEach(() => {
  vi.mocked(useStatesForType).mockImplementation((_projectId, itemType) => ({
    states: [makeState('Planned', itemType), makeState('Done', itemType)],
  } as ReturnType<typeof useStatesForType>))
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

const baseFeature: Feature = {
  system_id: 'f-1',
  id: null,
  title: 'Authentication',
  description: null,
  effort: 0,
  location: 'backlog',
  pi_id: null,
  swimlane_id: null,
  continued_from_feature_id: null,
  state_id: null,
  project_id: 'p-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const defaultProps = { open: true, onClose, onSubmit }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FeatureFormModal', () => {
  it('renders "New Feature" for a create modal', () => {
    render(<FeatureFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New Feature')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create feature/i })).toBeInTheDocument()
  })

  it('renders "Edit Feature" and pre-fills the fields when editing', () => {
    const feature: Feature = { ...baseFeature, id: 101, description: 'Login and SSO' }
    render(<FeatureFormModal {...defaultProps} feature={feature} />, { wrapper: makeWrapper() })

    expect(screen.getByText('Edit Feature')).toBeInTheDocument()
    expect(screen.getByLabelText(/title/i)).toHaveValue('Authentication')
    expect(screen.getByLabelText(/description/i)).toHaveValue('Login and SSO')
    expect(screen.getByLabelText(/^id/i)).toHaveValue(101)
  })

  it('submits the entered values', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<FeatureFormModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/title/i), 'Reporting')
    await userEvent.type(screen.getByLabelText(/description/i), 'PI reports')
    await userEvent.type(screen.getByLabelText(/^id/i), '250')
    await userEvent.click(screen.getByRole('button', { name: /create feature/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Reporting',
        description: 'PI reports',
        id: 250,
        state_id: null,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('normalises an empty description and ID to null', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<FeatureFormModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/title/i), 'Reporting')
    await userEvent.click(screen.getByRole('button', { name: /create feature/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: null, id: null }),
      ),
    )
  })

  it('shows a duplicate-ID error on a 409 and stays open', async () => {
    onSubmit.mockRejectedValue({
      response: { status: 409, data: { detail: { error: 'ID_ALREADY_EXISTS' } } },
    })
    const feature: Feature = { ...baseFeature, id: 101 }
    render(<FeatureFormModal {...defaultProps} feature={feature} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('ID 101 is already used in this project')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves the form untouched for an error that is not a duplicate ID', async () => {
    onSubmit.mockRejectedValue({ response: { status: 500, data: {} } })
    render(<FeatureFormModal {...defaultProps} feature={baseFeature} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(screen.queryByText(/already used in this project/i)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel closes without submitting', async () => {
    render(<FeatureFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // ── Read-only mode ───────────────────────────────────────────────────────────

  it('read-only mode disables the fields and hides the submit button', () => {
    render(
      <FeatureFormModal {...defaultProps} feature={baseFeature} readOnly />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Feature details')).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/title/i)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('read-only mode still exposes the work-item copy link', () => {
    const linked: Feature = { ...baseFeature, id: 42 }
    render(
      <FeatureFormModal {...defaultProps} feature={linked} readOnly />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByRole('button', { name: /copy work-item link/i })).toBeEnabled()
  })

  it('shows no work-item link on a create modal', () => {
    render(<FeatureFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.queryByRole('button', { name: /copy work-item link/i })).not.toBeInTheDocument()
  })
})

describe('FeatureFormModal State field', () => {
  it('pre-fills the State when editing', () => {
    render(
      <FeatureFormModal {...defaultProps} feature={{ ...baseFeature, state_id: 'st-Planned' }} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('state-select')).toHaveValue('st-Planned')
  })

  it('starts blank when the feature has no State', () => {
    render(<FeatureFormModal {...defaultProps} feature={baseFeature} />, { wrapper: makeWrapper() })
    expect(screen.getByTestId('state-select')).toHaveValue('')
  })

  it('submits the chosen State as state_id', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<FeatureFormModal {...defaultProps} feature={baseFeature} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Done')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ state_id: 'st-Done' })),
    )
  })

  it('submits null when the State is cleared', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(
      <FeatureFormModal {...defaultProps} feature={{ ...baseFeature, state_id: 'st-Planned' }} />,
      { wrapper: makeWrapper() },
    )

    await userEvent.selectOptions(screen.getByTestId('state-select'), '')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ state_id: null })),
    )
  })

  it('disables the State select in read-only mode', () => {
    render(
      <FeatureFormModal {...defaultProps} feature={baseFeature} readOnly />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('state-select')).toBeDisabled()
  })
})
