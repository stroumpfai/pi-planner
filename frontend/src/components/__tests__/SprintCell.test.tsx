import { vi, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SprintCell } from '../SprintCell'
import type { Group } from '@/types'

// Stub GroupCard: its internals need React Query + fully-shaped data; here we only
// care that SprintCell filters and forwards the right groups.
vi.mock('../GroupCard', () => ({
  GroupCard: ({ group }: { group: Group }) => <div data-testid="group-card">{group.name}</div>,
}))

function renderCell(props: Partial<React.ComponentProps<typeof SprintCell>> = {}) {
  return render(
    <DndContext>
      <SprintCell
        swimlaneId="sw-1"
        sprintIndex={0}
        groups={[]}
        projectId="p-1"
        {...props}
      />
    </DndContext>,
  )
}

describe('SprintCell', () => {
  it('renders an empty droppable cell with no groups', () => {
    const { container } = renderCell()
    // No group cards rendered when there are no matching groups.
    expect(container.querySelector('.min-h-16')).not.toBeNull()
  })

  it('renders only groups matching the sprint index', () => {
    const groups = [
      { system_id: 'g-1', sprint_index: 0, name: 'A' },
      { system_id: 'g-2', sprint_index: 1, name: 'B' },
    ] as unknown as Group[]

    const { getByText, queryByText } = renderCell({ groups, featureTitle: 'Feat' })

    expect(getByText('A')).toBeInTheDocument()
    expect(queryByText('B')).toBeNull()
  })
})
