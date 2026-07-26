import { useProject } from '@/hooks/useProjects'
import { buildWorkItemUrl } from '@/utils/workItemUrl'
import { copyToClipboard } from '@/utils/clipboard'

interface Props {
  readonly projectId: string
  readonly id: number | null | undefined
  /**
   * `card` — compact glyphs meant to sit next to an item's `[id]` badge; the
   * component reveals itself on hover/focus, so an ancestor must carry the
   * Tailwind `group` class. `inline` — a full, always-visible link + copy
   * button for use inside detail/edit modals.
   */
  readonly variant?: 'card' | 'inline'
  /** Optional label rendered above the link (inline variant only). */
  readonly label?: string
}

// Anchors/buttons live inside draggable, clickable cards. Stop pointer and
// click events so opening/copying the link never starts a drag or triggers the
// card's own handlers.
function stop(e: React.SyntheticEvent) {
  e.stopPropagation()
}

export function WorkItemLink({ projectId, id, variant = 'card', label }: Props) {
  const project = useProject(projectId)?.data
  const url = buildWorkItemUrl(project?.azure_devops_url, project?.work_item_path_template, id)
  if (!url) return null

  if (variant === 'inline') {
    return (
      <div>
        {label && <span className="block text-sm font-medium text-gray-700">{label}</span>}
        <div className="mt-1 flex items-center gap-2 min-w-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-xs text-blue-500 hover:text-blue-700"
            title={url}
          >
            {url} ↗
          </a>
          <button
            type="button"
            onClick={() => copyToClipboard(url, 'Work-item link copied')}
            title="Copy link"
            aria-label="Copy work-item link"
            className="shrink-0 text-xs text-gray-400 hover:text-blue-600"
          >
            ⧉
          </button>
        </div>
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        onPointerDown={stop}
        title="Open work item in tracker"
        aria-label="Open work item in tracker"
        className="text-xs text-blue-500 hover:text-blue-700"
      >
        ↗
      </a>
      <button
        type="button"
        onClick={(e) => { stop(e); copyToClipboard(url, 'Work-item link copied') }}
        onPointerDown={stop}
        title="Copy work-item link"
        aria-label="Copy work-item link"
        className="text-xs text-gray-400 hover:text-blue-600"
      >
        ⧉
      </button>
    </span>
  )
}
