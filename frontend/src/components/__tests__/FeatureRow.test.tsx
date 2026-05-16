import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeatureRow } from '../FeatureRow'
import { useAuthStore } from '@/stores/authStore'
import type { Feature } from '@/types'

vi.mock('@/services/features', () => ({
  featuresApi: { update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/services/pbis', () => ({
  pbisApi: { list: vi.fn().mockResolvedValue([]) },
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const baseFeature: Feature = {
  system_id: 'f-1',
  id: null,
  title: 'Auth Feature',
  description: null,
  effort: null,
  location: 'backlog',
  pi_id: null,
  swimlane_id: null,
  project_id: 'p-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => useAuthStore.setState({ user: null, isEditing: false }))

describe('FeatureRow', () => {
  it('shows title when id is null', () => {
    render(<FeatureRow feature={baseFeature} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('Auth Feature')).toBeInTheDocument()
    expect(screen.queryByText(/\[/)).not.toBeInTheDocument()
  })

  it('shows [101] prefix when user id is set', () => {
    render(
      <FeatureRow feature={{ ...baseFeature, id: 101 }} projectId="p-1" />,
      { wrapper: makeWrapper() },
    )
    // ID and title are in separate spans; use regex to find the ID prefix
    expect(screen.getByText(/\[101\]/)).toBeInTheDocument()
    expect(screen.getByText('Auth Feature')).toBeInTheDocument()
  })

  it('shows effort badge', () => {
    render(
      <FeatureRow feature={{ ...baseFeature, effort: 13 }} projectId="p-1" />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('13pts')).toBeInTheDocument()
  })

  it('edit and delete buttons disabled when not in edit mode', () => {
    useAuthStore.setState({ isEditing: false })
    render(<FeatureRow feature={baseFeature} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /edit/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('edit and delete buttons enabled in edit mode', () => {
    useAuthStore.setState({ isEditing: true })
    render(<FeatureRow feature={baseFeature} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /edit/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
  })

  it('expands to show PBIList on toggle', async () => {
    render(<FeatureRow feature={baseFeature} projectId="p-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /expand/i }))
    // PBIList renders — "No stories yet" confirms PBIList is mounted
    expect(await screen.findByText(/no stories yet/i)).toBeInTheDocument()
  })
})
