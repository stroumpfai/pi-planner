import type { PIState } from '@/types'

const CONFIG: Record<PIState, { label: string; className: string }> = {
  draft:       { label: 'Draft',       className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  closed:      { label: 'Closed',      className: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
}

interface Props {
  readonly state: PIState
}

export function PIStateBadge({ state }: Props) {
  const { label, className } = CONFIG[state] ?? CONFIG.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full shadow-soft-sm text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
