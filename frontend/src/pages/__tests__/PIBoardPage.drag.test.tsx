import { vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type * as dndCore from '@dnd-kit/core'
import { PIBoardPage } from '../PIBoardPage'
import { useAuthStore } from '@/stores/authStore'
import { groupsApi } from '@/services/groups'
import { pbisApi } from '@/services/pbis'

// dnd-kit produces the drag events; this spec is about what the board does with
// them. Stubbing DndContext hands us the real handlers to call with synthetic
// payloads — no browser, and it still proves the handlers are wired up.
const captured: { onDragStart?: (e: DragStartEvent) => void; onDragEnd?: (e: DragEndEvent) => void } = {}

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof dndCore>()
  return {
    ...actual,
    DndContext: (props: {
      children: React.ReactNode
      onDragStart?: (e: DragStartEvent) => void
      onDragEnd?: (e: DragEndEvent) => void
    }) => {
      captured.onDragStart = props.onDragStart
      captured.onDragEnd = props.onDragEnd
      return <div>{props.children}</div>
    },
    // The testid is on the stub, not on production markup: it is the only way to
    // read the overlay's label without matching text elsewhere on the board.
    DragOverlay: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="drag-overlay">{children}</div>
    ),
  }
})

// Children that mount their own droppables or fetch on render.
vi.mock('@/components/SwimlaneRow', () => ({ SwimlaneRow: () => <div>swimlane row</div> }))
vi.mock('@/components/BacklogPanel', () => ({ BacklogPanel: () => <div>backlog</div> }))
vi.mock('@/components/PIEventsRow', () => ({ PIEventsRow: () => <div>events</div> }))

vi.mock('@/services/groups', () => ({ groupsApi: { update: vi.fn() } }))
vi.mock('@/services/pbis', () => ({ pbisApi: { place: vi.fn() } }))

const hooks = vi.hoisted(() => ({
  updateFeature: vi.fn(),
  reorderSwimlines: vi.fn(),
}))

const fakePi = { system_id: 'pi-1', name: 'Q1', state: 'in_progress', project_id: 'proj-1' }
const piState = { current: fakePi as { system_id: string; name: string; state: string; project_id: string } }

const swimlaneA = { system_id: 'sw-1', pi_id: 'pi-1', name: 'Team A', position: 0 }
const swimlaneB = { system_id: 'sw-2', pi_id: 'pi-1', name: 'Team B', position: 1 }
const swimlaneC = { system_id: 'sw-3', pi_id: 'pi-1', name: 'Team C', position: 2 }

vi.mock('@/hooks/usePIs', () => ({ usePIs: () => ({ data: [piState.current] }) }))
vi.mock('@/hooks/useSwimlinesAndGroups', () => ({
  useSwimlinesForPI: () => ({ data: [swimlaneA, swimlaneB, swimlaneC] }),
  useReorderSwimlines: () => ({ mutate: hooks.reorderSwimlines }),
  useCreateSwimline: () => ({ mutate: vi.fn() }),
  useUpdateSwimline: () => ({ mutate: vi.fn() }),
  useDeleteSwimline: () => ({ mutate: vi.fn() }),
  useGroupsForSwimline: () => ({ data: [] }),
  useCreateGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useSprints', () => ({ useSprints: () => ({ data: [], isLoading: false }) }))
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ data: [{ system_id: 'f-1', id: 101, title: 'Auth', location: 'pi' }] }),
  useUpdateFeature: () => ({ mutate: hooks.updateFeature }),
}))
vi.mock('@/hooks/useProjects', () => ({ useEffortUnit: () => 'pts' }))
vi.mock('@/hooks/useMaxTextWidth', () => ({ useMaxTextWidth: () => 120 }))

// ── Drag payload factories ───────────────────────────────────────────────────

/** Fire a drag start and let the overlay render. */
function startDrag(data: Record<string, unknown>) {
  act(() => captured.onDragStart!({ active: { data: { current: data } } } as unknown as DragStartEvent))
}

const overlay = () => within(screen.getByTestId('drag-overlay'))

type Data = Record<string, unknown>
const drag = (activeData: Data, overData?: Data, ids = { active: 'a', over: 'o' }) =>
  ({
    active: { id: ids.active, data: { current: activeData } },
    over: overData === undefined ? null : { id: ids.over, data: { current: overData } },
  }) as unknown as DragEndEvent

const feature = (over: Data | undefined, from: Data = { fromLocation: 'pi', fromSwimlaneId: 'sw-1' }) =>
  drag({ type: 'feature', featureId: 'f-1', ...from }, over)

const featurezone = (swimlaneId: string) => ({ type: 'featurezone', swimlaneId, piId: 'pi-1' })
const sprintcell = (swimlaneId: string, sprintIndex?: number) => ({ type: 'sprintcell', swimlaneId, sprintIndex })

let queryClient: QueryClient
let invalidate: ReturnType<typeof vi.spyOn>

function renderBoard({ editing = true, piStateValue = 'in_progress' } = {}) {
  piState.current = { ...fakePi, state: piStateValue }
  useAuthStore.setState({
    user: { username: 'u', role: 'admin', display_name: 'U' },
    isEditing: editing,
  })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper })
}

describe('PIBoardPage drag handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(groupsApi.update).mockResolvedValue(undefined as never)
    vi.mocked(pbisApi.place).mockResolvedValue(undefined as never)
  })

  // ── handleDragStart: the overlay label ─────────────────────────────────────

  it('labels a dragged feature with its user ID and title', () => {
    renderBoard()
    startDrag({ type: 'feature', featureId: 'f-1' })
    expect(overlay().getByText('[101] Auth')).toBeInTheDocument()
  })

  it('falls back to "Feature" for a feature it cannot find', () => {
    renderBoard()
    startDrag({ type: 'feature', featureId: 'gone' })
    expect(overlay().getByText('Feature')).toBeInTheDocument()
  })

  it('labels a dragged swimlane with its name', () => {
    renderBoard()
    startDrag({ type: 'swimlane', swimlaneId: 'sw-2' })
    expect(overlay().getByText('Team B')).toBeInTheDocument()
  })

  it('falls back to "Swimlane" for a swimlane it cannot find', () => {
    renderBoard()
    startDrag({ type: 'swimlane', swimlaneId: 'gone' })
    expect(overlay().getByText('Swimlane')).toBeInTheDocument()
  })

  it('labels a dragged group and a dragged PBI', () => {
    renderBoard()
    startDrag({ type: 'group', groupId: 'Group 7' })
    expect(overlay().getByText('Group 7')).toBeInTheDocument()

    startDrag({ type: 'pbi', pbiLabel: '[7] Login form' })
    expect(overlay().getByText('[7] Login form')).toBeInTheDocument()
  })

  it('clears the overlay when the drag ends', () => {
    renderBoard()
    startDrag({ type: 'feature', featureId: 'f-1' })
    act(() => captured.onDragEnd!(feature(undefined)))
    expect(overlay().queryByText('[101] Auth')).not.toBeInTheDocument()
  })

  // ── handleDragEnd: guards ──────────────────────────────────────────────────

  it('does nothing when the drag ends outside any drop zone', () => {
    renderBoard()
    captured.onDragEnd!(feature(undefined))
    expect(hooks.updateFeature).not.toHaveBeenCalled()
  })

  it('does nothing when the user does not hold the edit lock', () => {
    renderBoard({ editing: false })
    captured.onDragEnd!(feature(featurezone('sw-2')))
    expect(hooks.updateFeature).not.toHaveBeenCalled()
  })

  it('does nothing on a closed PI even while editing', () => {
    renderBoard({ piStateValue: 'closed' })
    captured.onDragEnd!(feature(featurezone('sw-2')))
    expect(hooks.updateFeature).not.toHaveBeenCalled()
  })

  // ── Feature drops ──────────────────────────────────────────────────────────

  it('moves a feature to the swimlane it was dropped on', () => {
    renderBoard()
    captured.onDragEnd!(feature(featurezone('sw-2')))
    expect(hooks.updateFeature).toHaveBeenCalledWith({ featureId: 'f-1', body: { swimlane_id: 'sw-2' } })
  })

  it('ignores a feature dropped back on its own swimlane', () => {
    renderBoard()
    captured.onDragEnd!(feature(featurezone('sw-1')))
    expect(hooks.updateFeature).not.toHaveBeenCalled()
  })

  it('returns a feature to the backlog', () => {
    renderBoard()
    captured.onDragEnd!(feature({ type: 'backlog' }))
    expect(hooks.updateFeature).toHaveBeenCalledWith({ featureId: 'f-1', body: { location: 'backlog' } })
  })

  it('ignores a backlog feature dropped on the backlog', () => {
    renderBoard()
    captured.onDragEnd!(feature({ type: 'backlog' }, { fromLocation: 'backlog', fromSwimlaneId: null }))
    expect(hooks.updateFeature).not.toHaveBeenCalled()
  })

  // ── PBI → sprint cell ──────────────────────────────────────────────────────

  const pbiDrag = (over: Data, swimlaneId = 'sw-1') =>
    drag({ type: 'pbi', pbiId: 'pbi-1', pbiLabel: '[7] Login', featureId: 'f-1', swimlaneId }, over)

  it('places a PBI in the sprint cell it was dropped on', async () => {
    renderBoard()
    captured.onDragEnd!(pbiDrag(sprintcell('sw-1', 2)))

    expect(pbisApi.place).toHaveBeenCalledWith('pbi-1', { sprint_index: 2 })
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'sw-1'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pbis', 'proj-1'] })
    })
  })

  it('refuses to place a PBI in another swimlane', () => {
    renderBoard()
    captured.onDragEnd!(pbiDrag(sprintcell('sw-2', 2)))
    expect(pbisApi.place).not.toHaveBeenCalled()
  })

  it('treats a cell with no index as sprint 0', () => {
    renderBoard()
    captured.onDragEnd!(pbiDrag(sprintcell('sw-1')))
    expect(pbisApi.place).toHaveBeenCalledWith('pbi-1', { sprint_index: 0 })
  })

  it('swallows a failed placement — the next refetch corrects the board', async () => {
    renderBoard()
    vi.mocked(pbisApi.place).mockRejectedValue(new Error('boom'))
    captured.onDragEnd!(pbiDrag(sprintcell('sw-1', 1)))

    await vi.waitFor(() => expect(pbisApi.place).toHaveBeenCalled())
    expect(invalidate).not.toHaveBeenCalled()
  })

  // ── Group → sprint cell ────────────────────────────────────────────────────

  const groupDrag = (over: Data, fromSprintIndex: number | null = 0) =>
    drag({ type: 'group', groupId: 'g-1', swimlaneId: 'sw-1', fromSprintIndex }, over)

  it('moves a group to the sprint it was dropped on', async () => {
    renderBoard()
    captured.onDragEnd!(groupDrag(sprintcell('sw-1', 2)))

    expect(groupsApi.update).toHaveBeenCalledWith('g-1', { sprint_index: 2 })
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'sw-1'] }))
  })

  it('ignores a group dropped back on the sprint it came from', () => {
    renderBoard()
    captured.onDragEnd!(groupDrag(sprintcell('sw-1', 3), 3))
    expect(groupsApi.update).not.toHaveBeenCalled()
  })

  it('unassigns a group dropped on a cell with no index', () => {
    renderBoard()
    captured.onDragEnd!(groupDrag(sprintcell('sw-1'), 1))
    expect(groupsApi.update).toHaveBeenCalledWith('g-1', { sprint_index: null })
  })

  it('swallows a failed group move', async () => {
    renderBoard()
    vi.mocked(groupsApi.update).mockRejectedValue(new Error('boom'))
    captured.onDragEnd!(groupDrag(sprintcell('sw-1', 2)))

    await vi.waitFor(() => expect(groupsApi.update).toHaveBeenCalled())
    expect(invalidate).not.toHaveBeenCalled()
  })

  // ── Swimlane reorder ───────────────────────────────────────────────────────

  const swimlaneDrag = (activeId: string, overId: string) =>
    drag({ type: 'swimlane' }, { type: 'swimlane' }, { active: activeId, over: overId })

  it('reorders swimlanes, sending the moved lane and the new order', () => {
    renderBoard()
    captured.onDragEnd!(swimlaneDrag('swimlane:sw-1', 'swimlane:sw-3'))

    expect(hooks.reorderSwimlines).toHaveBeenCalledWith({
      swimlineId: 'sw-1',
      order: ['sw-2', 'sw-3', 'sw-1'],
    })
  })

  it('ignores a swimlane dropped on itself', () => {
    renderBoard()
    captured.onDragEnd!(swimlaneDrag('swimlane:sw-1', 'swimlane:sw-1'))
    expect(hooks.reorderSwimlines).not.toHaveBeenCalled()
  })

  it('ignores a reorder referencing a swimlane that is gone', () => {
    renderBoard()
    captured.onDragEnd!(swimlaneDrag('swimlane:sw-1', 'swimlane:gone'))
    expect(hooks.reorderSwimlines).not.toHaveBeenCalled()
  })
})
