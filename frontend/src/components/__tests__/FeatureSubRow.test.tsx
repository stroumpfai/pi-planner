import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureSubRow } from '../FeatureSubRow'
import type { Feature, Group, Sprint } from '@/types'

// The children are covered by their own specs; this one tests only the wiring.
vi.mock('../FeatureCard', () => ({
  FeatureCard: ({ feature, onCreateGroup }: {
    feature: Feature
    onCreateGroup: (featureId: string, pbiIds: string[]) => void
  }) => (
    <button type="button" onClick={() => onCreateGroup(feature.system_id, ['pbi-1', 'pbi-2'])}>
      card:{feature.title}
    </button>
  ),
}))

vi.mock('../SprintCell', () => ({
  SprintCell: ({ sprintIndex, swimlaneId, featureId, featureTitle }: {
    sprintIndex: number
    swimlaneId: string
    featureId: string
    featureTitle: string
  }) => (
    <div data-testid="sprint-cell" data-sprint={sprintIndex} data-swimlane={swimlaneId}
         data-feature={featureId} data-feature-title={featureTitle} />
  ),
}))

vi.mock('../CreateGroupModal', () => ({
  CreateGroupModal: ({ featureId, pbiIds, swimlaneId, onClose }: {
    featureId: string
    pbiIds: string[]
    swimlaneId: string
    onClose: () => void
  }) => (
    <div role="dialog">
      <span>group modal {featureId} / {swimlaneId} / {pbiIds.join(',')}</span>
      <button type="button" onClick={onClose}>close modal</button>
    </div>
  ),
}))

const feature: Feature = {
  system_id: 'f-1',
  id: 101,
  title: 'Authentication',
  description: null,
  effort: 0,
  location: 'pi',
  pi_id: 'pi-1',
  swimlane_id: 'sw-1',
  continued_from_feature_id: null,
  state_id: null,
  project_id: 'p-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const makeSprint = (index: number): Sprint => ({
  system_id: `s-${index}`,
  pi_id: 'pi-1',
  sprint_index: index,
  capacity: 10,
  start_date: null,
  end_date: null,
  effort: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
})

const groups: Group[] = []

const defaultProps = {
  feature,
  sprints: [makeSprint(0), makeSprint(1), makeSprint(2)],
  groups,
  projectId: 'p-1',
  swimlaneId: 'sw-1',
}

beforeEach(() => vi.clearAllMocks())

describe('FeatureSubRow', () => {
  it('renders the feature card', () => {
    render(<FeatureSubRow {...defaultProps} />)
    expect(screen.getByText('card:Authentication')).toBeInTheDocument()
  })

  it('renders one sprint cell per sprint, in sprint-index order', () => {
    render(<FeatureSubRow {...defaultProps} />)
    const cells = screen.getAllByTestId('sprint-cell')
    expect(cells).toHaveLength(3)
    expect(cells.map((c) => c.dataset.sprint)).toEqual(['0', '1', '2'])
  })

  it('passes the swimlane and feature identity down to each cell', () => {
    render(<FeatureSubRow {...defaultProps} />)
    for (const cell of screen.getAllByTestId('sprint-cell')) {
      expect(cell.dataset.swimlane).toBe('sw-1')
      expect(cell.dataset.feature).toBe('f-1')
      expect(cell.dataset.featureTitle).toBe('Authentication')
    }
  })

  it('falls back to sprint index 0 when a sprint has none', () => {
    const sprints = [{ ...makeSprint(0), sprint_index: null } as unknown as Sprint]
    render(<FeatureSubRow {...defaultProps} sprints={sprints} />)
    expect(screen.getByTestId('sprint-cell').dataset.sprint).toBe('0')
  })

  it('renders no sprint cells for a PI with no sprints', () => {
    render(<FeatureSubRow {...defaultProps} sprints={[]} />)
    expect(screen.queryByTestId('sprint-cell')).not.toBeInTheDocument()
  })

  it('opens no group modal until the card asks for one', () => {
    render(<FeatureSubRow {...defaultProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the group modal with the feature and PBIs the card supplied', async () => {
    render(<FeatureSubRow {...defaultProps} />)
    await userEvent.click(screen.getByText('card:Authentication'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('group modal f-1 / sw-1 / pbi-1,pbi-2')).toBeInTheDocument()
  })

  it('closing the group modal clears the pending group', async () => {
    render(<FeatureSubRow {...defaultProps} />)
    await userEvent.click(screen.getByText('card:Authentication'))
    await userEvent.click(screen.getByRole('button', { name: 'close modal' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
