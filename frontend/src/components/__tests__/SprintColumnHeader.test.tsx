import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SprintColumnHeader } from '../SprintColumnHeader'
import type { Sprint } from '@/types'

const makeSprint = (overrides: Partial<Sprint> = {}): Sprint => ({
  system_id: 's-1',
  pi_id: 'pi-1',
  sprint_index: 0,
  capacity: 0,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('SprintColumnHeader', () => {
  it('renders sprint label from sprint_index', () => {
    render(<SprintColumnHeader sprint={makeSprint({ sprint_index: 2 })} usedEffort={0} />)
    expect(screen.getByText('Sprint 3')).toBeInTheDocument()
  })

  it('shows 0/0 pts 0% when capacity is zero', () => {
    render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} />)
    expect(screen.getByText('0/0 pts - 0%')).toBeInTheDocument()
  })

  it('shows date range when both dates present', () => {
    render(
      <SprintColumnHeader
        sprint={makeSprint({ start_date: '2026-01-01', end_date: '2026-01-14' })}
        usedEffort={0}
      />
    )
    expect(screen.getByText('01.01.26 – 14.01.26')).toBeInTheDocument()
  })

  it('does not show dates when absent', () => {
    render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} />)
    expect(screen.queryByText(/–/)).not.toBeInTheDocument()
  })

  it('calls onEditCapacity when edit button clicked', async () => {
    const onEdit = vi.fn()
    render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} onEditCapacity={onEdit} />)
    await userEvent.click(screen.getByTitle('Edit capacity'))
    expect(onEdit).toHaveBeenCalled()
  })

  it('hides edit button when onEditCapacity not provided', () => {
    render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} />)
    expect(screen.queryByTitle('Edit capacity')).not.toBeInTheDocument()
  })
})
