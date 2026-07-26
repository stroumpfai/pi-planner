import { describe, it, expect } from 'vitest'
import { buildWorkItemUrl, AZURE_DEVOPS_TEMPLATE, JIRA_TEMPLATE } from '../workItemUrl'

describe('buildWorkItemUrl', () => {
  it('builds an Azure DevOps work-item URL', () => {
    expect(
      buildWorkItemUrl('https://devops-server.admin.ch/DefaultCollection/ASTRA_ISK', AZURE_DEVOPS_TEMPLATE, 153852),
    ).toBe('https://devops-server.admin.ch/DefaultCollection/ASTRA_ISK/_workitems/edit/153852')
  })

  it('builds a Jira URL', () => {
    expect(buildWorkItemUrl('https://jira.example.com', JIRA_TEMPLATE, 42)).toBe(
      'https://jira.example.com/browse/42',
    )
  })

  it('collapses a trailing slash on the base and a leading slash on the template', () => {
    expect(buildWorkItemUrl('https://x.test/', '/_workitems/edit/{id}', 7)).toBe(
      'https://x.test/_workitems/edit/7',
    )
  })

  it('replaces every {id} occurrence', () => {
    expect(buildWorkItemUrl('https://x.test', 'a/{id}/b/{id}', 5)).toBe('https://x.test/a/5/b/5')
  })

  it('returns null when the base URL is missing', () => {
    expect(buildWorkItemUrl(null, AZURE_DEVOPS_TEMPLATE, 1)).toBeNull()
    expect(buildWorkItemUrl('', AZURE_DEVOPS_TEMPLATE, 1)).toBeNull()
  })

  it('returns null when the template is missing or has no {id}', () => {
    expect(buildWorkItemUrl('https://x.test', null, 1)).toBeNull()
    expect(buildWorkItemUrl('https://x.test', '_workitems/edit/', 1)).toBeNull()
  })

  it('returns null when the id is missing', () => {
    expect(buildWorkItemUrl('https://x.test', AZURE_DEVOPS_TEMPLATE, null)).toBeNull()
    expect(buildWorkItemUrl('https://x.test', AZURE_DEVOPS_TEMPLATE, undefined)).toBeNull()
  })
})
