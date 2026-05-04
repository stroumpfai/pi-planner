import { render, screen } from '@testing-library/react'
import { CapacityBar } from '../CapacityBar'

describe('CapacityBar', () => {
  it('shows 0/0 pts 0% when capacity is zero', () => {
    render(<CapacityBar used={0} capacity={0} />)
    expect(screen.getByText('0/0 pts 0%')).toBeInTheDocument()
  })

  it('shows correct label', () => {
    render(<CapacityBar used={5} capacity={10} />)
    expect(screen.getByText('5/10 pts 50%')).toBeInTheDocument()
  })

  it('applies blue style when under 85%', () => {
    const { container } = render(<CapacityBar used={5} capacity={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-blue-500')
  })

  it('applies amber style at 85-100%', () => {
    const { container } = render(<CapacityBar used={9} capacity={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-amber-400')
  })

  it('applies red style when over capacity', () => {
    const { container } = render(<CapacityBar used={12} capacity={10} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-red-500')
  })

  it('applies gray style when capacity is zero', () => {
    const { container } = render(<CapacityBar used={0} capacity={0} />)
    const bar = container.querySelector('.h-full')
    expect(bar?.className).toContain('bg-gray-300')
  })
})
