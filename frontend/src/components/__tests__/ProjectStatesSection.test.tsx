import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectStatesSection } from '../ProjectStatesSection'
import { useDeleteState, useStates } from '@/hooks/useStates'
import type { ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

const makeState = (value: string, itemType: StateItemType, position = 0): ProjectState => ({
  system_id: `st-${itemType}-${value}`,
  project_id: 'p-1',
  item_type: itemType,
  value,
  position,
  category: null,
  created_at: '2026-01-01T00:00:00Z',
})

const mutateAsync = vi.fn()

const mockStates = (states: ProjectState[]) => {
  vi.mocked(useStates).mockReturnValue({
    data: states,
    isLoading: false,
  } as ReturnType<typeof useStates>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(undefined)
  vi.mocked(useDeleteState).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteState>)
  mockStates([])
})

describe('ProjectStatesSection', () => {
  it('lists each State under its own item type', () => {
    mockStates([
      makeState('New', 'feature'),
      makeState('Committed', 'story'),
      makeState('Active', 'bug'),
    ])
    render(<ProjectStatesSection projectId="p-1" />)

    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Committed')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows "None yet" for a list with no entries', () => {
    mockStates([makeState('New', 'feature')])
    render(<ProjectStatesSection projectId="p-1" />)
    // PBIs and Bugs are both empty.
    expect(screen.getAllByText('None yet')).toHaveLength(2)
  })

  it('deletes a State when its remove button is clicked', async () => {
    mockStates([makeState('Obsolete', 'feature')])
    render(<ProjectStatesSection projectId="p-1" />)

    await userEvent.click(screen.getByRole('button', { name: /remove State Obsolete/i }))
    expect(mutateAsync).toHaveBeenCalledWith('st-feature-Obsolete')
  })

  it('reports the backend message when the State is still in use', async () => {
    mockStates([makeState('In Progress', 'feature')])
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { message: "'In Progress' is still used by 3 items" } } },
    })
    render(<ProjectStatesSection projectId="p-1" />)

    await userEvent.click(screen.getByRole('button', { name: /remove State In Progress/i }))
    await waitFor(() =>
      expect(screen.getByText("'In Progress' is still used by 3 items")).toBeInTheDocument(),
    )
  })

  it('falls back to a generic message when the error carries no detail', async () => {
    mockStates([makeState('Done', 'feature')])
    mutateAsync.mockRejectedValue(new Error('network'))
    render(<ProjectStatesSection projectId="p-1" />)

    await userEvent.click(screen.getByRole('button', { name: /remove State Done/i }))
    await waitFor(() =>
      expect(screen.getByText(/could not delete this State/i)).toBeInTheDocument(),
    )
  })
})
