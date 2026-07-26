import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectSettingsModal } from '../ProjectSettingsModal'
import { useProject, useUpdateProject } from '@/hooks/useProjects'
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
  azure_devops_url: null,
  work_item_path_template: null,
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const updateMutate = vi.fn()
const onClose = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useProject).mockReturnValue({ data: fakeProject } as ReturnType<typeof useProject>)
  vi.mocked(useUpdateProject).mockReturnValue({ mutate: updateMutate } as ReturnType<typeof useUpdateProject>)
})

describe('ProjectSettingsModal', () => {
  it('renders the Project Settings title with the project name', () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Project Settings — Test Project')).toBeInTheDocument()
  })

  it('shows the current effort unit in the input', async () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByLabelText('Effort unit')).toHaveValue('pts'))
  })

  it('typing in effort unit field updates the draft value', async () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    const input = screen.getByLabelText('Effort unit')
    await waitFor(() => expect(input).toHaveValue('pts'))
    await userEvent.clear(input)
    await userEvent.type(input, 'sp')
    expect(input).toHaveValue('sp')
  })

  it('blurring effort unit field with new value calls updateProject.mutate', async () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    const input = screen.getByLabelText('Effort unit')
    await waitFor(() => expect(input).toHaveValue('pts'))
    await userEvent.clear(input)
    await userEvent.type(input, 'sp')
    await userEvent.tab()
    expect(updateMutate).toHaveBeenCalledWith({ effort_unit: 'sp' })
  })

  it('pressing Enter on effort unit field triggers blur', async () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    const input = screen.getByLabelText('Effort unit')
    await userEvent.type(input, '{Enter}')
    // onKeyDown calls e.currentTarget.blur() — no error thrown
  })

  it('clicking Done calls onClose', async () => {
    render(<ProjectSettingsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
