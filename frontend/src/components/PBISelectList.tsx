import { usePBIs } from '@/hooks/usePBIs'
import type { PBI } from '@/types'

interface Props {
  readonly featureId: string
  readonly projectId: string
  readonly selectedIds: Set<string>
  readonly onToggle: (pbiId: string) => void
}

function PBISelectRow({ pbi, selected, onToggle }: {
  pbi: PBI
  selected: boolean
  onToggle: () => void
}) {
  const displayId = pbi.id == null ? '' : `[${pbi.id}] `
  const isGrouped = pbi.group_id != null

  return (
    <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={isGrouped}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
      />
      <span className={`text-xs truncate ${isGrouped ? 'text-gray-400' : 'text-gray-700'}`}>
        {displayId && <span className="font-mono text-gray-400">{displayId}</span>}
        {pbi.title}
      </span>
      {pbi.effort != null && (
        <span className="ml-auto flex-shrink-0 text-xs text-purple-600">{pbi.effort}pt</span>
      )}
      {isGrouped && (
        <span className="flex-shrink-0 text-xs text-gray-400 italic">grouped</span>
      )}
    </label>
  )
}

export function PBISelectList({ featureId, projectId, selectedIds, onToggle }: Props) {
  const { data: pbis, isLoading } = usePBIs(projectId, featureId)

  if (isLoading) return <p className="text-xs text-gray-400 px-2 py-1">Loading…</p>
  if (!pbis?.length) return <p className="text-xs text-gray-300 px-2 py-1">No PBIs</p>

  return (
    <div className="space-y-0.5">
      {pbis.map((pbi) => (
        <PBISelectRow
          key={pbi.system_id}
          pbi={pbi}
          selected={selectedIds.has(pbi.system_id)}
          onToggle={() => onToggle(pbi.system_id)}
        />
      ))}
    </div>
  )
}
