import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIFormModal } from '../PBIFormModal'
import { useStates, useStatesForType } from '@/hooks/useStates'
import type { PBI, ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

// Every test here renders the modal, and the modal renders StateSelect (which reads
// useStatesForType) and reads useStates itself for the chosen State's category.
const mockStateLists = (values: Array<[string, ProjectState['category']]>) => {
  const all = (['story', 'bug'] as const).flatMap((t) =>
    values.map(([v, category]) => ({ ...makeState(v, t), category })),
  )
  vi.mocked(useStates).mockReturnValue({ data: all } as ReturnType<typeof useStates>)
  vi.mocked(useStatesForType).mockImplementation((_projectId, itemType) => ({
    states: all.filter((s) => s.item_type === itemType),
  } as ReturnType<typeof useStatesForType>))
}

beforeEach(() => {
  mockStateLists([['Committed', null], ['Done', null]])
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

describe('PBIFormModal Completed on field', () => {
  // Done-ness is the category, never the wording: "Done" here is uncategorised,
  // "Shipped" is the done-category State.
  beforeEach(() => {
    mockStateLists([['Committed', 'in_progress'], ['Done', null], ['Shipped', 'done']])
  })

  const todayDisplay = () => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  }

  const doneItem: PBI = { ...basePBI, state_id: 'st-Shipped', completed_on: '2026-03-14' }
  const field = () => screen.getByLabelText('Completed on')
  const save = () => userEvent.click(screen.getByRole('button', { name: /save changes/i }))
  const submitted = async () => {
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    return onSubmit.mock.calls[0][0] as Record<string, unknown>
  }
  const typeDate = async (dmy: string) => {
    await userEvent.clear(field())
    if (dmy) await userEvent.type(field(), dmy)
    await userEvent.tab()
  }

  it('is disabled while the item holds a State that is not done', () => {
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('')
  })

  it('is enabled for a done-category State and shows the saved date', () => {
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    expect(field()).toBeEnabled()
    expect(field()).toHaveValue('14.03.2026')
  })

  it('takes a fresher copy of the item that arrives just after opening', () => {
    // Saved, then reopened before the refetch landed: the modal opened on the
    // pre-save item, and must not keep showing — or later save — that copy.
    const { rerender } = render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    expect(field()).toHaveValue('')

    rerender(<PBIFormModal {...defaultProps} pbi={{ ...doneItem, modified_at: '2026-03-14T10:00:00Z' }} />)
    expect(screen.getByTestId('state-select')).toHaveValue('st-Shipped')
    expect(field()).toHaveValue('14.03.2026')
  })

  it('keeps in-progress edits when a fresher copy of the item arrives', async () => {
    const { rerender } = render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/title/i), ' v2')

    rerender(<PBIFormModal {...defaultProps} pbi={{ ...doneItem, modified_at: '2026-03-14T10:00:00Z' }} />)
    expect(screen.getByLabelText(/title/i)).toHaveValue('Login form v2')
  })

  it('stays disabled for a State named "Done" whose category is not done', async () => {
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Done')
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('')
  })

  it('prefills today on a change into done but leaves the stamp to the server', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(
      <PBIFormModal {...defaultProps} pbi={{ ...basePBI, state_id: 'st-Committed' }} />,
      { wrapper: makeWrapper() },
    )
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Shipped')
    expect(field()).toBeEnabled()
    expect(field()).toHaveValue(todayDisplay())

    await save()
    const body = await submitted()
    expect(body).toMatchObject({ state_id: 'st-Shipped' })
    expect(body).not.toHaveProperty('completed_on')
  })

  it('sends an edited date in ISO form', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await typeDate('02.01.2026')
    await save()
    expect(await submitted()).toMatchObject({ completed_on: '2026-01-02' })
  })

  it('sends a date edited after the prefill on a change into done', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={basePBI} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Shipped')
    await typeDate('30.06.2026')
    await save()
    expect(await submitted()).toMatchObject({ state_id: 'st-Shipped', completed_on: '2026-06-30' })
  })

  it('does not send the saved date when a done item is re-saved untouched', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await save()
    expect(await submitted()).not.toHaveProperty('completed_on')
  })

  it('clears and disables on a change out of done, and sends no date', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Committed')
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('')

    await save()
    const body = await submitted()
    expect(body).toMatchObject({ state_id: 'st-Committed' })
    expect(body).not.toHaveProperty('completed_on')
  })

  it('drops an edited date when the State then leaves done', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await typeDate('02.01.2026')
    await userEvent.selectOptions(screen.getByTestId('state-select'), '')

    await save()
    const body = await submitted()
    expect(body).toMatchObject({ state_id: null })
    expect(body).not.toHaveProperty('completed_on')
  })

  it('shows the saved date again when the State returns to done', async () => {
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Committed')
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Shipped')
    expect(field()).toHaveValue('14.03.2026')
  })

  it('snaps a blanked date back rather than clearing it', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await typeDate('')
    expect(field()).toHaveValue('14.03.2026')
    await save()
    expect(await submitted()).not.toHaveProperty('completed_on')
  })

  it('previews the date on create but keeps it disabled and unsent', async () => {
    onSubmit.mockResolvedValue(undefined)
    render(<PBIFormModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/title/i), 'Already shipped')
    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Shipped')
    expect(field()).toHaveValue(todayDisplay())
    expect(field()).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /create pbi/i }))
    expect(await submitted()).not.toHaveProperty('completed_on')
  })

  it('is disabled in read-only mode even for a done item', () => {
    render(<PBIFormModal {...defaultProps} pbi={doneItem} readOnly />, { wrapper: makeWrapper() })
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('14.03.2026')
  })

  it('shows a 422 NOT_COMPLETED under the field and keeps the modal open', async () => {
    onSubmit.mockRejectedValue({
      response: { status: 422, data: { detail: { error: 'NOT_COMPLETED' } } },
    })
    render(<PBIFormModal {...defaultProps} pbi={doneItem} />, { wrapper: makeWrapper() })
    await typeDate('02.01.2026')
    await save()
    await waitFor(() =>
      expect(screen.getByText(/only a done item has a completion date/i)).toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
