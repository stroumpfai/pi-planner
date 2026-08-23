import { vi, describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIBoardPage } from '../PIBoardPage'
import { useAuthStore } from '@/stores/authStore'
import { useSwimlaneCollapseStore } from '@/stores/swimlaneCollapseStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useToastStore } from '@/stores/toastStore'
import * as pisService from '@/services/pis'

// ── Heavy hooks ──────────────────────────────────────────────────────────────
vi.mock('@/hooks/usePIs', () => ({
  usePIs: () => ({ data: [{ ...fakePi, state: board.piState }] }),
}))
const fakeSwimline = {
  system_id: 'sw-1',
  pi_id: 'pi-1',
  name: 'Team A',
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

// Mutable so a test can render an empty board, or one with sprint columns.
const board = vi.hoisted(() => ({
  swimlines: [] as unknown[],
  sprints: [] as unknown[],
  events: [] as unknown[],
  sprintsLoading: false,
  piState: 'in_progress' as string,
}))

vi.mock('@/hooks/useSwimlinesAndGroups', () => ({
  useSwimlinesForPI: () => ({ data: board.swimlines }),
  useCreateSwimline: () => ({ mutate: vi.fn() }),
  useUpdateSwimline: () => ({ mutate: vi.fn() }),
  useDeleteSwimline: () => ({ mutate: vi.fn() }),
  useReorderSwimlines: () => ({ mutate: vi.fn() }),
  useGroupsForSwimline: () => ({ data: [] }),
  useCreateGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useSprints', () => ({
  useSprints: () => ({ data: board.sprints, isLoading: board.sprintsLoading }),
  useUpdateSprint: () => ({ mutate: vi.fn(), isPending: false }),
}))
// PIEventsRow fetches on render; without this the spec hits the network.
vi.mock('@/hooks/usePIEvents', () => ({
  usePIEvents: () => ({ data: board.events }),
  useCreatePIEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePIEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePIEvent: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ data: [] }),
  useUpdateFeature: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useProjects', () => ({
  useEffortUnit: () => 'pts',
}))
vi.mock('@/hooks/useMaxTextWidth', () => ({
  useMaxTextWidth: () => 120,
}))

// ── Service download functions ────────────────────────────────────────────────
vi.mock('@/services/pis', async (importOriginal) => {
  const actual = await importOriginal<typeof pisService>()
  return {
    ...actual,
    downloadPICSV: vi.fn().mockResolvedValue(undefined),
    downloadPIPNG: vi.fn().mockResolvedValue(undefined),
  }
})

// ── Fake data ─────────────────────────────────────────────────────────────────
const fakePi = {
  system_id: 'pi-1',
  name: 'PI 2024.1',
  state: 'in_progress' as const,
  total_effort: 10,
  total_capacity: 20,
  project_id: 'proj-1',
  description: null,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const fakeSprint = {
  system_id: 'sp-1',
  pi_id: 'pi-1',
  name: 'Sprint 1',
  sprint_index: 0,
  capacity: 20,
  effort: 5,
  start_date: '2026-01-05',
  end_date: '2026-01-16',
}

const fakeEvent = {
  system_id: 'ev-1',
  pi_id: 'pi-1',
  name: 'Go live',
  event_date: '2026-01-08',
  event_type: 'release' as const,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('PIBoardPage export buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    board.swimlines = [fakeSwimline]
    board.sprints = []
    board.events = []
    board.sprintsLoading = false
    board.piState = 'in_progress'
    useToastStore.setState({ toasts: [] })
    useSettingsStore.setState({ focusMode: false })
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: false,
    })
  })

  it('renders Export CSV and Export PNG buttons', async () => {
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument()
    })
  })

  it('calls downloadPICSV when Export CSV is clicked', async () => {
    const mockDownloadCsv = vi.mocked(pisService.downloadPICSV)

    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const csvBtn = await screen.findByRole('button', { name: /export csv/i })
    await userEvent.click(csvBtn)

    await waitFor(() => {
      expect(mockDownloadCsv).toHaveBeenCalledOnce()
      expect(mockDownloadCsv).toHaveBeenCalledWith('pi-1', 'PI 2024.1')
    })
  })

  it('opens the export PNG modal when Export PNG is clicked', async () => {
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const pngBtn = await screen.findByRole('button', { name: /export png/i })
    await userEvent.click(pngBtn)

    await waitFor(() => {
      // The modal dialog should be present
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // All 6 toggle checkboxes inside the modal
      expect(screen.getAllByRole('checkbox')).toHaveLength(6)
    })
  })

  it('collapses all swimlanes when Collapse All is clicked', async () => {
    useSwimlaneCollapseStore.setState({ collapsed: {} })

    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const collapseBtn = await screen.findByRole('button', { name: /collapse all/i })
    await userEvent.click(collapseBtn)

    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(true)
  })

  it('expands all swimlanes when Expand All is clicked', async () => {
    useSwimlaneCollapseStore.setState({ collapsed: { 'pi-1:sw-1': true } })

    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const expandBtn = await screen.findByRole('button', { name: /expand all/i })
    await userEvent.click(expandBtn)

    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(false)
  })

  it('shows loading text while CSV is exporting', async () => {
    vi.mocked(pisService.downloadPICSV).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const csvBtn = await screen.findByRole('button', { name: /export csv/i })
    await userEvent.click(csvBtn)

    expect(await screen.findByRole('button', { name: /exporting/i })).toBeInTheDocument()
  })

  // ── Feature column resize ───────────────────────────────────────────────────

  it('widens and narrows the feature column with the arrow keys', async () => {
    useSettingsStore.setState({ featureColumnWidth: 200 })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const handle = await screen.findByRole('button', { name: /resize feature column/i })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(208)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(200)
  })

  it('ignores other keys on the resize handle', async () => {
    useSettingsStore.setState({ featureColumnWidth: 200 })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const handle = await screen.findByRole('button', { name: /resize feature column/i })
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(200)
  })

  it.each([
    ['widening past the maximum', 480, 'ArrowRight'],
    ['narrowing past the minimum', 120, 'ArrowLeft'],
  ])('clamps the keyboard resize when %s', async (_case, start, key) => {
    useSettingsStore.setState({ featureColumnWidth: start })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    fireEvent.keyDown(await screen.findByRole('button', { name: /resize feature column/i }), { key })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(start)
  })

  it('resizes by dragging the handle, and stops tracking on mouse up', async () => {
    useSettingsStore.setState({ featureColumnWidth: 200 })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const handle = await screen.findByRole('button', { name: /resize feature column/i })
    fireEvent.mouseDown(handle, { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 360 })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(260)

    // Past the maximum, the width clamps rather than running away.
    fireEvent.mouseMove(document, { clientX: 900 })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(480)

    fireEvent.mouseUp(document)
    fireEvent.mouseMove(document, { clientX: 310 })
    expect(useSettingsStore.getState().featureColumnWidth).toBe(480)
  })

  // ── Modals open and close ───────────────────────────────────────────────────

  it.each([
    ['Export PNG', /export png/i],
    ['Reports', /reports/i],
  ])('opens and closes the %s modal', async (_label, name) => {
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByRole('button', { name }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel|close/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens and closes the add-swimlane modal', async () => {
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: true,
    })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByRole('button', { name: /\+ add swimlane/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // ── Board states that only appear with different data ───────────────────────

  it('offers to add the first swimlane on an empty board', async () => {
    board.swimlines = []
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: true,
    })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    expect(await screen.findByText('No swimlanes yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add first swimlane/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('hides the empty-board call to action for a read-only user', async () => {
    board.swimlines = []
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    expect(await screen.findByText('No swimlanes yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add first swimlane/i })).not.toBeInTheDocument()
  })

  it('opens and closes the capacity editor from a sprint column', async () => {
    board.sprints = [fakeSprint]
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: true,
    })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    // Both controls are glyph buttons ("✎", "+"), so the title is the only label.
    await userEvent.click(await screen.findByTitle('Edit capacity'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('offers no capacity editor without the edit lock', async () => {
    board.sprints = [fakeSprint]
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    expect(await screen.findByText('Sprint 1')).toBeInTheDocument()
    expect(screen.queryByTitle('Edit capacity')).not.toBeInTheDocument()
  })

  it('opens and closes the PI event editor', async () => {
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: true,
    })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByTitle('Add event'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a loading message until the sprints arrive', async () => {
    board.sprintsLoading = true
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    expect(await screen.findByText('Loading board…')).toBeInTheDocument()
  })

  it('toasts when the CSV export fails', async () => {
    vi.mocked(pisService.downloadPICSV).mockRejectedValue(new Error('boom'))
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByRole('button', { name: /export csv/i }))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('CSV export failed')
    )
    expect(await screen.findByRole('button', { name: /export csv/i })).toBeEnabled()
  })

  it('badges a PI that is not in progress with its own state', async () => {
    board.piState = 'planning'
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    expect(await screen.findByText('planning')).toBeInTheDocument()
    expect(screen.queryByText('In progress')).not.toBeInTheDocument()
  })

  it('toggles focus mode, which hides the backlog panel', async () => {
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByTitle('Enter focus mode'))
    expect(useSettingsStore.getState().focusMode).toBe(true)

    await userEvent.click(await screen.findByTitle('Exit focus mode'))
    expect(useSettingsStore.getState().focusMode).toBe(false)
  })

  it('opens the event editor for an existing event', async () => {
    board.sprints = [fakeSprint]
    board.events = [fakeEvent]
    useAuthStore.setState({
      user: { username: 'testuser', role: 'admin', display_name: 'Test User' },
      isEditing: true,
    })
    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    await userEvent.click(await screen.findByTitle(/Go live/))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
