import { render, screen } from '@testing-library/react'
import { StalenessBadge } from '../StalenessBadge'
import type { ProjectPushStatus } from '@/types'

const status = (over: Partial<ProjectPushStatus> = {}): ProjectPushStatus => ({
  project_id: 'p-1',
  project_name: 'ISK Portal',
  team_id: 't-1',
  team_name: 'Platform',
  share_pct: 70,
  available_source: 'factor',
  stale_sprints: 0,
  last_pushed_at: '2026-04-20T09:30:00Z',
  ...over,
})

describe('StalenessBadge', () => {
  it('counts the sprints that would change', () => {
    render(<StalenessBadge status={status({ stale_sprints: 3 })} />)
    expect(screen.getByText('3 sprints differ from the team')).toBeInTheDocument()
  })

  it('reads as one sprint rather than "1 sprints"', () => {
    render(<StalenessBadge status={status({ stale_sprints: 1 })} />)
    expect(screen.getByText('1 sprint differs from the team')).toBeInTheDocument()
  })

  it('is quiet when the numbers already agree', () => {
    render(<StalenessBadge status={status()} />)
    expect(screen.getByText('in sync')).toBeInTheDocument()
  })

  it('distinguishes never pushed from in sync', () => {
    // Different states: one means the numbers match, the other that nothing has
    // ever flowed and the board still holds hand-typed values.
    render(<StalenessBadge status={status({ last_pushed_at: null })} />)
    expect(screen.getByText('never pushed')).toBeInTheDocument()
  })

  it('adds the push timestamp where there is room for it', () => {
    render(<StalenessBadge status={status()} showPushedAt />)
    expect(screen.getByText(/in sync · pushed Apr 20, 2026/)).toBeInTheDocument()
  })

  it('renders nothing for a manual project, which can never be behind', () => {
    const { container } = render(
      <StalenessBadge status={status({ available_source: 'manual', stale_sprints: 0 })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when no team serves the project', () => {
    const { container } = render(<StalenessBadge status={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
