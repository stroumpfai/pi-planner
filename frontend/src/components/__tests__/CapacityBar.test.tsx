import { render, screen } from '@testing-library/react'
import { CapacityBar } from '../CapacityBar'
import { useSettingsStore } from '@/stores/settingsStore'

beforeEach(() => useSettingsStore.setState({ showEffortUnit: true }))

describe('CapacityBar', () => {
  it('shows 0/0 pts 0% when Available is zero', () => {
    render(<CapacityBar used={0} available={0} />)
    expect(screen.getByText('0/0 pts - 0%')).toBeInTheDocument()
  })

  it('shows correct label', () => {
    render(<CapacityBar used={5} available={10} />)
    expect(screen.getByText('5/10 pts - 50%')).toBeInTheDocument()
  })

  it('applies blue style when under 85%', () => {
    const { container } = render(<CapacityBar used={5} available={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-blue-500')
  })

  it('applies amber style at 85-100%', () => {
    const { container } = render(<CapacityBar used={9} available={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-amber-400')
  })

  it('applies red style when over Available', () => {
    const { container } = render(<CapacityBar used={12} available={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-red-500')
  })

  it('applies gray style when Available is zero and nothing is placed', () => {
    const { container } = render(<CapacityBar used={0} available={0} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-gray-300')
  })

  it('reads as over-capacity, not 0%, when effort is placed against no budget', () => {
    // 12 points against a budget of 0 is the most over-committed a sprint can be;
    // the old gray "0/0 - 0%" made it look like nothing was set (teams.md §6.2).
    const { container } = render(<CapacityBar used={12} available={0} />)
    expect(screen.getByText('12/0 pts - over')).toBeInTheDocument()
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-red-500')
  })
})
