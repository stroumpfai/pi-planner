import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { FeatureCard } from '../FeatureCard'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { useFeatures, useUpdateFeature, useSplitFeature } from '@/hooks/useFeatures'
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
]

function mockCommonHooks(allFeatures: Feature[]) {
  vi.mocked(useFeatures).mockReturnValue({ data: allFeatures } as ReturnType<typeof useFeatures>)
  vi.mocked(usePIs).mockReturnValue({ data: PIS } as ReturnType<typeof usePIs>)
  vi.mocked(usePBIs).mockReturnValue({ data: [] } as unknown as ReturnType<typeof usePBIs>)
  vi.mocked(useSwimlinesForPI).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useSwimlinesForPI>)
  vi.mocked(useEffortUnit).mockReturnValue('pts')
  vi.mocked(useUpdateFeature).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateFeature>)
  vi.mocked(useSplitFeature).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSplitFeature>)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
  useUiStore.setState({ activePIId: null })
})

describe('FeatureCard continuation badges', () => {
  it('shows no badge when the feature has no continuation link', () => {
    mockCommonHooks([baseFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.queryByText(/continued/i)).not.toBeInTheDocument()
  })

  it('shows a "continued from" badge on the continuation feature', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={continuationFeature} projectId="p-1" />)
    expect(screen.getByText(/continued from PI 1/i)).toBeInTheDocument()
  })

  it('shows a "continued in" badge on the original feature', () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.getByText(/continued in PI 2/i)).toBeInTheDocument()
  })

  it('jumps to the linked PI when a badge is clicked', async () => {
    mockCommonHooks([baseFeature, continuationFeature])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    screen.getByText(/continued in PI 2/i).click()
    expect(useUiStore.getState().activePIId).toBe('pi-2')
  })

  it('summarizes multiple continuations instead of picking one', () => {
    const secondContinuation: Feature = { ...continuationFeature, system_id: 'f-3', pi_id: 'pi-2' }
    mockCommonHooks([baseFeature, continuationFeature, secondContinuation])
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    expect(screen.getByText(/continued in 2 PIs/i)).toBeInTheDocument()
  })
})

describe('FeatureCard move-to-PI action', () => {
  it('is hidden until PBIs are selected, even with the PBI panel expanded', () => {
    mockCommonHooks([baseFeature])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={baseFeature} projectId="p-1" />)
    screen.getByTitle('Select PBIs to group').click()
    expect(screen.queryByText(/move .* pbi.* to pi/i)).not.toBeInTheDocument()
  })

  it('is not offered for a backlog feature even when editing', () => {
    mockCommonHooks([{ ...baseFeature, location: 'backlog', pi_id: null, swimlane_id: null }])
    useAuthStore.setState({ user: null, isEditing: true })
    renderWithDnd(<FeatureCard feature={{ ...baseFeature, location: 'backlog', pi_id: null, swimlane_id: null }} projectId="p-1" />)
    screen.getByTitle('Select PBIs to group').click()
    expect(screen.queryByText(/move .* pbi.* to pi/i)).not.toBeInTheDocument()
  })
})
