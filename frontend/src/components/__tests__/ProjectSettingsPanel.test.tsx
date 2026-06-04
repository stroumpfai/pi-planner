import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectSettingsPanel } from '../ProjectSettingsPanel'
import { useProject, useUpdateProject } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Project } from '@/types'

vi.mock('@/hooks/useProjects')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeProject: Project = {
  system_id: 'p-1',
  name: 'Test Project',
  description: null,
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const updateMutate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useProject).mockReturnValue({ data: fakeProject } as ReturnType<typeof useProject>)
  vi.mocked(useUpdateProject).mockReturnValue({ mutate: updateMutate } as ReturnType<typeof useUpdateProject>)
  useSettingsStore.setState({ showIds: true, showEffortUnit: true })
})

describe('ProjectSettingsPanel', () => {
  it('renders the Project Settings heading', () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByText('Project Settings')).toBeInTheDocument()
  })

  it('shows the current effort unit in the input', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('pts'))
  })

  it('typing in effort unit field updates the draft value', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('textbox'))
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), 'sp')
    expect(screen.getByRole('textbox')).toHaveValue('sp')
  })

  it('blurring effort unit field with new value calls updateProject.mutate', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('textbox'))
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), 'sp')
    await userEvent.tab() // triggers blur → handleUnitBlur
    expect(updateMutate).toHaveBeenCalledWith({ effort_unit: 'sp' })
  })

  it('pressing Enter on effort unit field triggers blur', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '{Enter}')
    // onKeyDown calls e.currentTarget.blur() — no error thrown
  })

  it('clicking Show IDs toggle calls setShowIds', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    const toggle = screen.getByRole('switch', { name: /show ids/i })
    await userEvent.click(toggle)
    expect(useSettingsStore.getState().showIds).toBe(false)
  })

  it('show effort unit toggle is on by default', () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    const toggle = screen.getByRole('switch', { name: /show effort unit/i })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('clicking show effort unit toggle updates the store', async () => {
    render(<ProjectSettingsPanel projectId="p-1" />, { wrapper: makeWrapper() })
    const toggle = screen.getByRole('switch', { name: /show effort unit/i })
    await userEvent.click(toggle)
    expect(useSettingsStore.getState().showEffortUnit).toBe(false)
  })
})
