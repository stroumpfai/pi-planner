import type { PIState } from '@/types'

const CONFIG: Record<PIState, { label: string; className: string }> = {
  draft:       { label: 'Draft',       className: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
  closed:      { label: 'Closed',      className: 'bg-green-100 text-green-700' },
}

interface Props {
  readonly state: PIState
}

export function PIStateBadge({ state }: Props) {
  const { label, className } = CONFIG[state] ?? CONFIG.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
