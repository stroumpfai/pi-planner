import { render, screen } from '@testing-library/react'
import { PIStateBadge } from '../PIStateBadge'

describe('PIStateBadge', () => {
  it('renders Draft with gray style', () => {
    render(<PIStateBadge state="draft" />)
    const badge = screen.getByText('Draft')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-gray-100')
  })

  it('renders In Progress with blue style', () => {
    render(<PIStateBadge state="in_progress" />)
    const badge = screen.getByText('In Progress')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-blue-100')
  })

  it('renders Closed with green style', () => {
    render(<PIStateBadge state="closed" />)
    const badge = screen.getByText('Closed')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-green-100')
  })
})
