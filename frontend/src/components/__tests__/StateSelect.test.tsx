import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StateSelect } from '../StateSelect'
import { useStatesForType } from '@/hooks/useStates'
import type { ProjectState, StateItemType } from '@/types'

vi.mock('@/hooks/useStates')

const makeState = (value: string, itemType: StateItemType, position: number): ProjectState => ({
  system_id: `st-${value}`,
  project_id: 'p-1',
  item_type: itemType,
  value,
  position,
  created_at: '2026-01-01T00:00:00Z',
  category: null,
})

const mockStates = (states: ProjectState[]) => {
  vi.mocked(useStatesForType).mockReturnValue({ states } as ReturnType<typeof useStatesForType>)
}

describe('StateSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStates([])
  })

  it('offers every State in the list for this item type, in list order', () => {
    mockStates([
      makeState('New', 'feature', 0),
      makeState('In Progress', 'feature', 1),
    ])
    render(<StateSelect itemType="feature" value={null} onChange={vi.fn()} projectId="p-1" />)

    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['(none)', 'New', 'In Progress'])
  })

  it('is a select, offering no way to type a new State', () => {
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value={null} onChange={vi.fn()} projectId="p-1" />)
    expect(screen.getByTestId('state-select').tagName).toBe('SELECT')
  })

  it('shows the current State by id', () => {
    mockStates([makeState('Done', 'feature', 0)])
    render(<StateSelect itemType="feature" value="st-Done" onChange={vi.fn()} projectId="p-1" />)
    expect(screen.getByTestId('state-select')).toHaveValue('st-Done')
  })

  it('reports the chosen state_id, not its text', async () => {
    const onChange = vi.fn()
    mockStates([makeState('New', 'feature', 0), makeState('Done', 'feature', 1)])
    render(<StateSelect itemType="feature" value={null} onChange={onChange} projectId="p-1" />)

    await userEvent.selectOptions(screen.getByTestId('state-select'), 'st-Done')
    expect(onChange).toHaveBeenCalledWith('st-Done')
  })

  it('reports null when (none) is chosen', async () => {
    const onChange = vi.fn()
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value="st-New" onChange={onChange} projectId="p-1" />)

    await userEvent.selectOptions(screen.getByTestId('state-select'), '')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('points at the States editor when the list is empty', () => {
    render(<StateSelect itemType="feature" value={null} onChange={vi.fn()} projectId="p-1" />)
    expect(screen.getByText(/Edit Project → Manage States/)).toBeInTheDocument()
    expect(screen.getByTestId('state-select')).toBeDisabled()
  })

  it('hides the empty-state hint once the list has entries', () => {
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value={null} onChange={vi.fn()} projectId="p-1" />)
    expect(screen.queryByText(/Manage States/)).not.toBeInTheDocument()
  })

  it('disables the field in read-only mode', () => {
    mockStates([makeState('New', 'feature', 0)])
    render(
      <StateSelect itemType="feature" value="st-New" onChange={vi.fn()} projectId="p-1" disabled />,
    )
    expect(screen.getByTestId('state-select')).toBeDisabled()
  })

  it('requests the list for the given item type', () => {
    render(<StateSelect itemType="bug" value={null} onChange={vi.fn()} projectId="p-1" />)
    expect(useStatesForType).toHaveBeenCalledWith('p-1', 'bug')
  })
})
