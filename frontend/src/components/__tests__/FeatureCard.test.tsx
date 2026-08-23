import { vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { FeatureCard } from '../FeatureCard'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { useFeatures, useUpdateFeature, useSplitFeature, useCancelContinuation } from '@/hooks/useFeatures'
import { usePIs } from '@/hooks/usePIs'
import { usePBIs } from '@/hooks/usePBIs'
import { useSwimlinesForPI } from '@/hooks/useSwimlinesAndGroups'
import { useEffortUnit } from '@/hooks/useProjects'
import type { Feature } from '@/types'

vi.mock('@/hooks/useFeatures')
vi.mock('@/hooks/usePIs')
vi.mock('@/hooks/usePBIs')
vi.mock('@/hooks/useSwimlinesAndGroups')
vi.mock('@/hooks/useProjects')
// The State dropdown inside the feature modal queries the project's State Lists;
// this file renders without a QueryClientProvider.
vi.mock('@/hooks/useStates', () => ({
  useStates: () => ({ data: [], isLoading: false }),
  useStatesForType: () => ({ states: [], isLoading: false }),
}))

const renderWithDnd = (ui: React.ReactElement) => render(<DndContext>{ui}</DndContext>)

const baseFeature: Feature = {
  system_id: 'f-1',
  id: 101,
  title: 'Auth Feature',
  description: null,
  effort: 5,
  location: 'pi',
  pi_id: 'pi-1',
  swimlane_id: 'sw-1',
  continued_from_feature_id: null,
  project_id: 'p-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const continuationFeature: Feature = {
  ...baseFeature,
  system_id: 'f-2',
  title: 'Auth Feature',
  pi_id: 'pi-2',
  swimlane_id: 'sw-2',
  continued_from_feature_id: 'f-1',
}

const PIS = [
  { system_id: 'pi-1', project_id: 'p-1', name: 'PI 1', description: null, state: 'in_progress', start_date: null, end_date: null, created_at: '', modified_at: '', total_effort: 0, total_capacity: 0 },
  { system_id: 'pi-2', project_id: 'p-1', name: 'PI 2', description: null, state: 'draft', start_date: null, end_date: null, created_at: '', modified_at: '', total_effort: 0, total_capacity: 0 },
  { system_id: 'pi-3', project_id: 'p-1', name: 'PI 3', description: null, state: 'draft', start_date: null, end_date: null, created_at: '', modified_at: '', total_effort: 0, total_capacity: 0 },
]

function mockCommonHooks(allFeatures: Feature[]) {
  vi.mocked(useFeatures).mockReturnValue({ data: allFeatures } as ReturnType<typeof useFeatures>)
  vi.mocked(usePIs).mockReturnValue({ data: PIS } as ReturnType<typeof usePIs>)
  vi.mocked(usePBIs).mockReturnValue({ data: [] } as unknown as ReturnType<typeof usePBIs>)
  vi.mocked(useSwimlinesForPI).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useSwimlinesForPI>)
  vi.mocked(useEffortUnit).mockReturnValue('pts')
  vi.mocked(useUpdateFeature).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateFeature>)
  vi.mocked(useSplitFeature).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSplitFeature>)
  vi.mocked(useCancelContinuation).mockReturnValue({
    mutate: cancelMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCancelContinuation>)
}

let cancelMutate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  cancelMutate = vi.fn()
  useAuthStore.setState({ user: null, isEditing: false })
  useUiStore.setState({ activePIId: null })
})

describe('FeatureCard continuation badges', () => {
  it('shows no badge when the feature has no continuation link', () => {
    mockCommonHooks([baseFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.queryByText(/also in/i)).not.toBeInTheDocument()
  })

  it('lists the predecessor PI on the continuation feature', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.getByText(/also in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PI 1' })).toBeInTheDocument()
  })

  it('lists the successor PI on the original feature', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.getByText(/also in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PI 2' })).toBeInTheDocument()
  })

  it('jumps to the linked PI when a PI is clicked', async () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'PI 2' }))
    expect(useUiStore.getState().activePIId).toBe('pi-2')
  })

  it('lists each continuation PI as its own link', () => {
    const secondContinuation: Feature = { ...continuationFeature, system_id: 'f-3', pi_id: 'pi-3' }
    mockCommonHooks([baseFeature, continuationFeature, secondContinuation])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.getByRole('button', { name: 'PI 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PI 3' })).toBeInTheDocument()
  })

  it('lists the whole chain (both directions) except the PI being viewed', () => {
    // A(pi-1) → B(pi-2) → C(pi-3); rendering the middle feature B.
    const chainEnd: Feature = { ...baseFeature, system_id: 'f-3', pi_id: 'pi-3', continued_from_feature_id: 'f-2' }
    mockCommonHooks([baseFeature, continuationFeature, chainEnd])
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.getByRole('button', { name: 'PI 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PI 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PI 2' })).not.toBeInTheDocument()
  })
})

describe('FeatureCard cancel-continuation action', () => {
  const grandchild: Feature = { ...continuationFeature, system_id: 'f-3', pi_id: 'pi-2', continued_from_feature_id: 'f-2' }

  it('offers cancel on a leaf continuation while editing', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.getByText('✕ cancel')).toBeInTheDocument()
  })

  it('hides cancel when not editing', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.queryByText('✕ cancel')).not.toBeInTheDocument()
  })

  it('hides cancel on a non-leaf continuation (split further downstream)', () => {
    mockCommonHooks([baseFeature, continuationFeature, grandchild])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.queryByText('✕ cancel')).not.toBeInTheDocument()
  })

  it('confirming calls the cancel mutation with the feature id', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    fireEvent.click(screen.getByText('✕ cancel'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel continuation' }))
    expect(cancelMutate).toHaveBeenCalledWith('f-2', expect.anything())
  })
})

describe('FeatureCard edit / view affordance', () => {
  it('shows an Edit icon opening an editable modal when holding the lock', async () => {
    mockCommonHooks([baseFeature])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)

    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/title/i)).toHaveValue('Auth Feature')
    expect(within(dialog).getByLabelText(/title/i)).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('shows a View-details icon opening a read-only modal when not holding the lock', async () => {
    mockCommonHooks([baseFeature])
    useAuthStore.setState({ user: null, isEditing: false })
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/title/i)).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /close/i })).toBeInTheDocument()
  })
})

describe('FeatureCard move-to-PI action', () => {
  it('is hidden until PBIs are selected, even with the PBI panel expanded', () => {
    mockCommonHooks([baseFeature])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    fireEvent.click(screen.getByTitle('Select PBIs to group'))
    expect(screen.queryByText(/move .* pbi.* to pi/i)).not.toBeInTheDocument()
  })

  it('is not offered for a backlog feature even when editing', () => {
    mockCommonHooks([{ ...baseFeature, location: 'backlog', pi_id: null, swimlane_id: null }])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={{ ...baseFeature, location: 'backlog', pi_id: null, swimlane_id: null }} projectId="p-1" />)
    fireEvent.click(screen.getByTitle('Select PBIs to group'))
    expect(screen.queryByText(/move .* pbi.* to pi/i)).not.toBeInTheDocument()
  })
})
