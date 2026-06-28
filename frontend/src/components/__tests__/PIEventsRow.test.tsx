import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIEventsRow } from '../PIEventsRow'
import * as piEventsService from '@/services/piEvents'
import { useSettingsStore } from '@/stores/settingsStore'
import type { PIEvent, Sprint } from '@/types'

vi.mock('@/services/piEvents')
const mockApi = vi.mocked(piEventsService.piEventsApi)

const makeSprint = (index: number, start?: string, end?: string): Sprint => ({
  system_id: `s-${index}`,
  pi_id: 'pi-1',
  sprint_index: index,
  capacity: 10,
  effort: 0,
  start_date: start ?? null,
  end_date: end ?? null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
})

const makeEvent = (overrides: Partial<PIEvent> = {}): PIEvent => ({
  system_id: 'ev-1',
  pi_id: 'pi-1',
  name: 'Release v2',
  event_date: '2026-06-15',
  event_type: 'release',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const sprints = [
  makeSprint(0, '2026-05-01', '2026-05-14'),
  makeSprint(1, '2026-05-15', '2026-05-28'),
  makeSprint(2, '2026-06-01', '2026-06-15'),
  makeSprint(3, '2026-06-16', '2026-06-30'),
  makeSprint(4, '2026-07-01', '2026-07-14'),
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({ showPIEvents: true })
})

describe('PIEventsRow', () => {
  it('renders the "Events" label when showPIEvents is true', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    expect(await screen.findByText('Events')).toBeInTheDocument()
  })

  it('returns null when showPIEvents is false', () => {
    useSettingsStore.setState({ showPIEvents: false })
    mockApi.list = vi.fn().mockResolvedValue([])
    const { container } = render(
      <PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />,
      { wrapper: Wrapper },
    )
    expect(container.firstChild).toBeNull()
  })

  it('places a release event in the matching sprint column', async () => {
    const ev = makeEvent({ event_date: '2026-06-15', event_type: 'release', name: 'Release v2' })
    mockApi.list = vi.fn().mockResolvedValue([ev])
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    expect(await screen.findByText('Release v2')).toBeInTheDocument()
    expect(screen.getByTitle(/Release: Release v2/)).toBeInTheDocument()
  })

  it('shows the correct icon for each event type', async () => {
    const events: PIEvent[] = [
      makeEvent({ system_id: 'e1', event_type: 'release',   name: 'R', event_date: '2026-06-01' }),
      makeEvent({ system_id: 'e2', event_type: 'milestone', name: 'M', event_date: '2026-06-01' }),
      makeEvent({ system_id: 'e3', event_type: 'deadline',  name: 'D', event_date: '2026-06-01' }),
      makeEvent({ system_id: 'e4', event_type: 'pilot',     name: 'P', event_date: '2026-06-01' }),
      makeEvent({ system_id: 'e5', event_type: 'go_no_go',  name: 'G', event_date: '2026-06-01' }),
      makeEvent({ system_id: 'e6', event_type: 'other',     name: 'O', event_date: '2026-06-01' }),
    ]
    mockApi.list = vi.fn().mockResolvedValue(events)
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    await screen.findByText('R')
    expect(screen.getByTitle(/Release: R/)).toBeInTheDocument()
    expect(screen.getByTitle(/Milestone: M/)).toBeInTheDocument()
    expect(screen.getByTitle(/Deadline: D/)).toBeInTheDocument()
    expect(screen.getByTitle(/Pilot: P/)).toBeInTheDocument()
    expect(screen.getByTitle(/Go\/No-Go: G/)).toBeInTheDocument()
    expect(screen.getByTitle(/Other: O/)).toBeInTheDocument()
  })

  it('places event in nearest sprint when date is outside all ranges', async () => {
    const ev = makeEvent({ event_date: '2026-08-01', name: 'Future Event' })
    mockApi.list = vi.fn().mockResolvedValue([ev])
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    // Should appear (in the last sprint since 2026-08-01 is closest to sprint 4's end)
    expect(await screen.findByText('Future Event')).toBeInTheDocument()
  })

  it('places event in first sprint when no sprint has dates', async () => {
    const noDateSprints = [makeSprint(0), makeSprint(1), makeSprint(2)]
    const ev = makeEvent({ event_date: '2026-06-15', name: 'Undated' })
    mockApi.list = vi.fn().mockResolvedValue([ev])
    render(
      <PIEventsRow piId="pi-1" sprints={noDateSprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />,
      { wrapper: Wrapper },
    )
    expect(await screen.findByText('Undated')).toBeInTheDocument()
  })

  it('shows the + add button when canEdit is true', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={true} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    await screen.findByText('Events')
    expect(screen.getByTitle('Add event')).toBeInTheDocument()
  })

  it('hides the + add button when canEdit is false', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIEventsRow piId="pi-1" sprints={sprints} canEdit={false} onAdd={vi.fn()} onEdit={vi.fn()} />, { wrapper: Wrapper })
    await screen.findByText('Events')
    expect(screen.queryByTitle('Add event')).not.toBeInTheDocument()
  })
})
