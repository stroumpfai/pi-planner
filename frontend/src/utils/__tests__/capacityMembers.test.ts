import { splitByCapacity } from '../capacityMembers'

describe('splitByCapacity', () => {
  it('puts members who count first, keeping the saved order within each group', () => {
    const { counted, notCounted } = splitByCapacity([
      { name: 'Pia', counts_towards_capacity: false },
      { name: 'Marta', counts_towards_capacity: true },
      { name: 'Olaf', counts_towards_capacity: false },
      { name: 'Rui', counts_towards_capacity: true },
    ])

    expect(counted.map((m) => m.name)).toEqual(['Marta', 'Rui'])
    expect(notCounted.map((m) => m.name)).toEqual(['Pia', 'Olaf'])
  })

  it('counts a member whose flag is missing, since true is the default', () => {
    const members: { name: string; counts_towards_capacity?: boolean }[] = [{ name: 'Marta' }]
    const { counted, notCounted } = splitByCapacity(members)

    expect(counted).toHaveLength(1)
    expect(notCounted).toHaveLength(0)
  })
})
