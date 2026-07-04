import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIBoardPage } from '../PIBoardPage'
import { useAuthStore } from '@/stores/authStore'
import * as pisService from '@/services/pis'

// ── Heavy hooks ──────────────────────────────────────────────────────────────
vi.mock('@/hooks/usePIs', () => ({
  usePIs: () => ({ data: [fakePi] }),
}))
vi.mock('@/hooks/useSwimlinesAndGroups', () => ({
  useSwimlinesForPI: () => ({ data: [] }),
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
  useSprints: () => ({ data: [], isLoading: false }),
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

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('PIBoardPage export buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows loading text while CSV is exporting', async () => {
    vi.mocked(pisService.downloadPICSV).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    render(<PIBoardPage projectId="proj-1" piId="pi-1" />, { wrapper: makeWrapper() })

    const csvBtn = await screen.findByRole('button', { name: /export csv/i })
    await userEvent.click(csvBtn)

    expect(await screen.findByRole('button', { name: /exporting/i })).toBeInTheDocument()
  })
})
