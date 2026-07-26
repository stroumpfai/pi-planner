// Presets for the per-project work-item path template. The template is a
// relative path appended to the project's `azure_devops_url` to form a deep
// link to a single work item; `{id}` is replaced with the item's user id.
export const AZURE_DEVOPS_TEMPLATE = '_workitems/edit/{id}'
export const JIRA_TEMPLATE = 'browse/{id}'

/**
 * Build a work-item deep link from a project base URL, a path template, and an
 * item id. Returns `null` when any part is missing (the feature is effectively
 * off until the project is configured, and id-less items have no link).
 *
 * The base URL is expected to already be a validated http(s) URL and the
 * template a validated relative path containing `{id}` (both enforced by the
 * backend), so the result cannot introduce a new scheme or host.
 */
export function buildWorkItemUrl(
  baseUrl: string | null | undefined,
  template: string | null | undefined,
  id: number | null | undefined,
): string | null {
  if (!baseUrl || !template || id == null) return null
  if (!template.includes('{id}')) return null
  const base = baseUrl.replace(/\/+$/, '')
  const path = template.replace(/\{id\}/g, String(id)).replace(/^\/+/, '')
  return `${base}/${path}`
}
