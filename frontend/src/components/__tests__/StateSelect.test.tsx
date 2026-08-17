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
  category: null,
  created_at: '2026-01-01T00:00:00Z',
})

const mockStates = (states: ProjectState[]) => {
  vi.mocked(useStatesForType).mockReturnValue({ states } as ReturnType<typeof useStatesForType>)
}

describe('StateSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStates([])
  })

  it('offers every State in the list for this item type', () => {
    mockStates([
      makeState('New', 'feature', 0),
      makeState('In Progress', 'feature', 1),
    ])
    render(<StateSelect itemType="feature" value="" onChange={vi.fn()} projectId="p-1" />)

    const options = document.querySelectorAll('datalist option')
    expect([...options].map((o) => o.getAttribute('value'))).toEqual(['New', 'In Progress'])
  })

  it('shows the current value', () => {
    mockStates([makeState('Done', 'feature', 0)])
    render(<StateSelect itemType="feature" value="Done" onChange={vi.fn()} projectId="p-1" />)
    expect(screen.getByTestId('state-select')).toHaveValue('Done')
  })

  it('explains the empty state before the first import', () => {
    render(<StateSelect itemType="feature" value="" onChange={vi.fn()} projectId="p-1" />)
    expect(screen.getByText(/no States for this item type yet/i)).toBeInTheDocument()
  })

  it('hides the empty-state hint once the list has entries', () => {
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value="" onChange={vi.fn()} projectId="p-1" />)
    expect(screen.queryByText(/no States for this item type yet/i)).not.toBeInTheDocument()
  })

  it('reports a typed value that is not in the list', async () => {
    const onChange = vi.fn()
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value="" onChange={onChange} projectId="p-1" />)

    await userEvent.type(screen.getByTestId('state-select'), 'X')
    expect(onChange).toHaveBeenCalledWith('X')
  })

  it('disables the field in read-only mode', () => {
    mockStates([makeState('New', 'feature', 0)])
    render(<StateSelect itemType="feature" value="New" onChange={vi.fn()} projectId="p-1" disabled />)
    expect(screen.getByTestId('state-select')).toBeDisabled()
  })

  it('requests the list for the given item type', () => {
    render(<StateSelect itemType="bug" value="" onChange={vi.fn()} projectId="p-1" />)
    expect(useStatesForType).toHaveBeenCalledWith('p-1', 'bug')
  })
})
