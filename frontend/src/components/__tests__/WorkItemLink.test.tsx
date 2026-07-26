import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkItemLink } from '../WorkItemLink'
import { useProject } from '@/hooks/useProjects'
import type { Project } from '@/types'

vi.mock('@/hooks/useProjects')
const mockUseProject = vi.mocked(useProject)

const baseProject: Project = {
  system_id: 'proj-1',
  name: 'P',
  description: null,
  azure_devops_url: 'https://devops.test/Coll/Proj',
  work_item_path_template: '_workitems/edit/{id}',
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

function mockProject(overrides: Partial<Project> = {}) {
  mockUseProject.mockReturnValue({ data: { ...baseProject, ...overrides } } as ReturnType<typeof useProject>)
}

describe('WorkItemLink', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders an external link with the built href', () => {
    mockProject()
    render(<WorkItemLink projectId="proj-1" id={153852} />)
    const link = screen.getByRole('link', { name: /open work item/i })
    expect(link).toHaveAttribute('href', 'https://devops.test/Coll/Proj/_workitems/edit/153852')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders nothing when the project has no base URL', () => {
    mockProject({ azure_devops_url: null })
    const { container } = render(<WorkItemLink projectId="proj-1" id={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the item has no id', () => {
    mockProject()
    const { container } = render(<WorkItemLink projectId="proj-1" id={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('copies the link to the clipboard', async () => {
    mockProject()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<WorkItemLink projectId="proj-1" id={7} />)
    await userEvent.click(screen.getByRole('button', { name: /copy work-item link/i }))
    expect(writeText).toHaveBeenCalledWith('https://devops.test/Coll/Proj/_workitems/edit/7')
  })

  it('renders the inline variant with a label', () => {
    mockProject()
    render(<WorkItemLink projectId="proj-1" id={7} variant="inline" label="Work item" />)
    expect(screen.getByText('Work item')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://devops.test/Coll/Proj/_workitems/edit/7',
    )
  })
})
