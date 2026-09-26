import { render, screen } from '@testing-library/react'
import { CapacityMembersSummary } from '../CapacityMembersSummary'

describe('CapacityMembersSummary', () => {
  it('says so when everyone counts', () => {
    render(
      <CapacityMembersSummary
        members={[
          { name: 'Marta', counts_towards_capacity: true },
          { name: 'Rui', counts_towards_capacity: true },
        ]}
      />,
    )

    expect(screen.getByText('2 members · all count towards capacity')).toBeInTheDocument()
  })

  it('names the members who do not count, with their role when there is one', () => {
    const { container } = render(
      <CapacityMembersSummary
        members={[
          { name: 'Marta', role: 'Dev', counts_towards_capacity: true },
          { name: 'Pia', role: 'PO', counts_towards_capacity: false },
          { name: 'Olaf', role: null, counts_towards_capacity: false },
        ]}
      />,
    )

    expect(container).toHaveTextContent(
      '3 members · 1 counts towards capacity · 2 tracked for absences only: Pia (PO), Olaf',
    )
  })

  it('renders nothing for a team with no members', () => {
    const { container } = render(<CapacityMembersSummary members={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
