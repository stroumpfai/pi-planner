import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SprintColumnHeader } from '../SprintColumnHeader'
import type { ProjectPushStatus, Sprint } from '@/types'

const makeSprint = (overrides: Partial<Sprint> = {}): Sprint => ({
  system_id: 's-1',
  pi_id: 'pi-1',
  sprint_index: 0,
  available: 0,
  effort: 0,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const derived = (over: Partial<ProjectPushStatus> = {}): ProjectPushStatus => ({
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

describe('SprintColumnHeader', () => {
  it('renders sprint label from sprint_index', () => {
    render(<SprintColumnHeader sprint={makeSprint({ sprint_index: 2 })} usedEffort={0} />)
    expect(screen.getByText('Sprint 3')).toBeInTheDocument()
  })

  it('shows 0/0 pts 0% when Available is zero', () => {
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
    await userEvent.click(screen.getByTitle('Edit Available'))
    expect(onEdit).toHaveBeenCalled()
  })

  it('hides edit button when onEditCapacity not provided', () => {
    render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} />)
    expect(screen.queryByTitle('Edit Available')).not.toBeInTheDocument()
  })

  // ── Derived Available (teams.md §6.4, §6.6) ────────────────────────────────

  it('names the team a derived Available came from', () => {
    render(
      <SprintColumnHeader
        sprint={makeSprint({ available: 21, available_pushed_at: '2026-04-20T09:30:00Z' })}
        usedEffort={0}
        pushStatus={derived()}
      />,
    )
    expect(screen.getByText(/Platform/)).toBeInTheDocument()
    expect(screen.getByText(/pushed Apr 20, 2026/)).toBeInTheDocument()
  })

  it('keeps the pencil on a derived sprint, because the dates are still editable', () => {
    // Only Available is derived; no team write touches a sprint's dates, and the
    // dialog behind the pencil is their only editor.
    render(
      <SprintColumnHeader
        sprint={makeSprint({ available: 21 })}
        usedEffort={0}
        onEditCapacity={vi.fn()}
        pushStatus={derived()}
      />,
    )
    expect(screen.queryByTitle('Edit Available')).not.toBeInTheDocument()
    expect(screen.getByTitle('Edit sprint dates')).toBeInTheDocument()
  })

  it('says so when a derived sprint has never been pushed', () => {
    render(
      <SprintColumnHeader
        sprint={makeSprint({ available: 0, available_pushed_at: null })}
        usedEffort={0}
        pushStatus={derived({ last_pushed_at: null })}
      />,
    )
    expect(screen.getByText('never pushed')).toBeInTheDocument()
  })

  it('keeps the pencil on a manual project, which is every project until someone opts in', () => {
    render(
      <SprintColumnHeader
        sprint={makeSprint()}
        usedEffort={0}
        onEditCapacity={vi.fn()}
        pushStatus={derived({ available_source: 'manual' })}
      />,
    )
    expect(screen.getByTitle('Edit Available')).toBeInTheDocument()
  })

  it('names the public holidays that cost the team time, and draws nothing without any', () => {
    const { rerender } = render(<SprintColumnHeader sprint={makeSprint()} usedEffort={0} />)
    expect(screen.queryByText(/public holiday/)).not.toBeInTheDocument()

    rerender(
      <SprintColumnHeader
        sprint={makeSprint({ start_date: '2026-04-06', end_date: '2026-04-17' })}
        usedEffort={0}
        holidays={[
          { label: 'Easter Monday', calendar_name: 'National', start_date: '2026-04-06', start_half: 'am', end_date: '2026-04-06', end_half: 'pm' },
          { label: 'Office closed', calendar_name: 'Company', start_date: '2026-04-07', start_half: 'pm', end_date: '2026-04-07', end_half: 'pm' },
        ]}
      />,
    )
    const chip = screen.getByText('2 public holidays')
    // On the dates' row, not a row of its own — or this column's bar would sit
    // lower than its neighbours'.
    expect(chip.parentElement).toContainElement(screen.getByText(/–/))
    expect(chip.title).toContain('Easter Monday · 2026-04-06 · National')
    expect(chip.title).toContain('Office closed · 2026-04-07 afternoon · Company')
  })
})
