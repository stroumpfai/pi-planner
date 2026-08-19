import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectStatesModal } from '../ProjectStatesModal'
import {
  useCreateState,
  useDeleteState,
  useRenameState,
  useReorderStates,
  useStates,
} from '@/hooks/useStates'
import type { ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

const makeState = (value: string, itemType: StateItemType, position: number): ProjectState => ({
  system_id: `st-${value}`,
  project_id: 'p-1',
  item_type: itemType,
  value,
  position,
  category: null,
  created_at: '2026-01-01T00:00:00Z',
})

const mutations = {
  create: vi.fn(),
  rename: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
}

const mockMutation = (mutateAsync: ReturnType<typeof vi.fn>) =>
  ({ mutateAsync, isPending: false }) as unknown as ReturnType<typeof useCreateState>

const renderModal = (states: ProjectState[]) => {
  vi.mocked(useStates).mockReturnValue(
    { data: states, isLoading: false } as ReturnType<typeof useStates>,
  )
  return render(<ProjectStatesModal open projectId="p-1" onClose={vi.fn()} />)
}

const featureList = () => within(screen.getByTestId('state-list-feature'))

describe('ProjectStatesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const fn of Object.values(mutations)) fn.mockResolvedValue(undefined)
    vi.mocked(useCreateState).mockReturnValue(mockMutation(mutations.create))
    vi.mocked(useRenameState).mockReturnValue(
      mockMutation(mutations.rename) as ReturnType<typeof useRenameState>,
    )
    vi.mocked(useReorderStates).mockReturnValue(
      mockMutation(mutations.reorder) as ReturnType<typeof useReorderStates>,
    )
    vi.mocked(useDeleteState).mockReturnValue(
      mockMutation(mutations.remove) as ReturnType<typeof useDeleteState>,
    )
  })

  it('shows each list separately', () => {
    renderModal([
      makeState('New', 'feature', 0),
      makeState('Committed', 'story', 0),
      makeState('Active', 'bug', 0),
    ])
    expect(featureList().getByText('New')).toBeInTheDocument()
    expect(within(screen.getByTestId('state-list-story')).getByText('Committed')).toBeInTheDocument()
    expect(within(screen.getByTestId('state-list-bug')).getByText('Active')).toBeInTheDocument()
  })

  it('adds a State to the list it was typed into', async () => {
    renderModal([])
    await userEvent.type(screen.getByLabelText('New Bugs State'), 'Active')
    await userEvent.click(within(screen.getByTestId('state-list-bug')).getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({ item_type: 'bug', value: 'Active' }),
    )
  })

  it('renames a State in place', async () => {
    renderModal([makeState('In Progres', 'feature', 0)])
    await userEvent.click(featureList().getByRole('button', { name: 'Rename In Progres' }))

    const input = featureList().getByRole('textbox', { name: 'Rename In Progres' })
    await userEvent.clear(input)
    await userEvent.type(input, 'In Progress{Enter}')

    await waitFor(() =>
      expect(mutations.rename).toHaveBeenCalledWith({
        stateId: 'st-In Progres',
        value: 'In Progress',
      }),
    )
  })

  it('moves a State down, sending the whole new order', async () => {
    renderModal([makeState('Zulu', 'feature', 0), makeState('Alpha', 'feature', 1)])
    await userEvent.click(featureList().getByRole('button', { name: 'Move Zulu down' }))

    await waitFor(() =>
      expect(mutations.reorder).toHaveBeenCalledWith({
        item_type: 'feature',
        order: ['st-Alpha', 'st-Zulu'],
      }),
    )
  })

  it('disables up at the top and down at the bottom', () => {
    renderModal([makeState('First', 'feature', 0), makeState('Last', 'feature', 1)])
    expect(featureList().getByRole('button', { name: 'Move First up' })).toBeDisabled()
    expect(featureList().getByRole('button', { name: 'Move First down' })).toBeEnabled()
    expect(featureList().getByRole('button', { name: 'Move Last up' })).toBeEnabled()
    expect(featureList().getByRole('button', { name: 'Move Last down' })).toBeDisabled()
  })

  it('deletes a State', async () => {
    renderModal([makeState('Obsolete', 'feature', 0)])
    await userEvent.click(featureList().getByRole('button', { name: 'Delete Obsolete' }))
    await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith('st-Obsolete'))
  })

  it('reports the backend message when an in-use State cannot be deleted', async () => {
    mutations.remove.mockRejectedValue({
      response: { data: { detail: { message: "'New' is still used by 3 items" } } },
    })
    renderModal([makeState('New', 'feature', 0)])

    await userEvent.click(featureList().getByRole('button', { name: 'Delete New' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("'New' is still used by 3 items")
  })

  it('reports the backend message when a duplicate is added', async () => {
    mutations.create.mockRejectedValue({
      response: { data: { detail: { message: "This list already contains 'Done'" } } },
    })
    renderModal([makeState('Done', 'feature', 0)])

    await userEvent.type(screen.getByLabelText('New Features State'), 'done')
    await userEvent.click(featureList().getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("This list already contains 'Done'")
  })

  it('reports the backend message when a rename collides', async () => {
    mutations.rename.mockRejectedValue({
      response: { data: { detail: { message: "This list already contains 'Done'" } } },
    })
    renderModal([makeState('Done', 'feature', 0), makeState('New', 'feature', 1)])

    await userEvent.click(featureList().getByRole('button', { name: 'Rename New' }))
    const input = featureList().getByRole('textbox', { name: 'Rename New' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Done{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent("This list already contains 'Done'")
  })

  it('says so when a list is empty', () => {
    renderModal([])
    expect(featureList().getByText('None yet')).toBeInTheDocument()
  })
})
