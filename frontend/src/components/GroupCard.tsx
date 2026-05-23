import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { usePBIs, useUpdatePBI } from '@/hooks/usePBIs'
import { useDeleteGroup, useUpdateGroup } from '@/hooks/useSwimlinesAndGroups'
import { useAuthStore } from '@/stores/authStore'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import { pbisApi } from '@/services/pbis'
import type { Group, PBI } from '@/types'

export interface GroupDragData {
  type: 'group'
  groupId: string
  swimlaneId: string
  fromSprintIndex: number | null
}

interface Props {
  readonly group: Group
  readonly projectId: string
}

const SPRINT_LABELS = ['S1', 'S2', 'S3', 'S4', 'S5']

function InlinePBITitle({ pbi, projectId }: { readonly pbi: PBI; readonly projectId: string }) {
  const isEditing = useAuthStore((s) => s.isEditing)
  const showIds = useSettingsStore((s) => s.showIds)
  const updatePBI = useUpdatePBI(projectId)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')

  function start() {
    if (!isEditing) return
    setTitle(pbi.title)
    setEditing(true)
  }

  function submit() {
    const trimmed = title.trim()
    if (trimmed && trimmed !== pbi.title) {
      updatePBI.mutate({ pbiId: pbi.system_id, body: { title: trimmed } })
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { submit() } else if (e.key === 'Escape') { setEditing(false) } }}
        onBlur={submit}
        className="flex-1 text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none w-full"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={!isEditing}
      title={isEditing ? 'Click to edit' : undefined}
      className="text-xs text-gray-600 break-words text-left disabled:cursor-default hover:enabled:text-gray-900 w-full min-w-0"
    >
      {showIds && pbi.id != null && <span className="font-mono text-gray-400">[{pbi.id}] </span>}
      {pbi.title}
    </button>
  )
}

export function GroupCard({ group, projectId }: Props) {
  const isEditing = useAuthStore((s) => s.isEditing)
  const effortUnit = useEffortUnit(projectId)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const deleteGroup = useDeleteGroup(group.swimline_id)
  const updateGroup = useUpdateGroup(group.swimline_id)

  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: allPbis } = usePBIs(projectId, group.feature_system_id)
  const groupPbis = allPbis?.filter((p) => p.group_id === group.system_id) ?? []
  const totalEffort = groupPbis.reduce((sum, p) => sum + (p.effort ?? 0), 0)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group:${group.system_id}`,
    data: {
      type: 'group',
      groupId: group.system_id,
      swimlaneId: group.swimline_id,
      fromSprintIndex: group.sprint_index,
    } satisfies GroupDragData,
  })

  function handleUngroup() {
    if (group.is_implicit && group.story_system_id) {
      void pbisApi.unplace(group.story_system_id)
    } else {
      deleteGroup.mutate(group.system_id)
    }
  }

  function handleMoveSprint(e: React.ChangeEvent<HTMLSelectElement>) {
    updateGroup.mutate({
      groupId: group.system_id,
      body: { sprint_index: Number(e.target.value) },
    })
  }

  function handleRenameSubmit() {
    const trimmed = newName.trim()
    if (!trimmed) return
    updateGroup.mutate({ groupId: group.system_id, body: { name: trimmed } })
    setRenaming(false)
  }

  const headerBg = group.is_implicit ? 'bg-blue-50' : ''

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border rounded-md shadow-sm transition-opacity ${
        isDragging ? 'opacity-40 border-blue-400' : 'border-gray-200'
      }`}
    >
      {/* Drag handle + name row */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b border-gray-100 ${headerBg}`}
        {...attributes}
        {...listeners}
      >
        {renaming ? (
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { handleRenameSubmit() } else if (e.key === 'Escape') { setRenaming(false) } }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none"
          />
        ) : (
          <span className={`text-xs font-semibold flex-1 min-w-0 line-clamp-2 break-words ${group.is_implicit ? 'text-blue-700 italic' : 'text-gray-800'}`}>
            {group.name}
          </span>
        )}
        {isEditing && !renaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setNewName(group.name); setRenaming(true) }}
            className="text-xs text-gray-400 hover:text-blue-600 flex-shrink-0"
            title="Rename group"
          >✎</button>
        )}
        {totalEffort > 0 && (
          <span className="flex-shrink-0 text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">
            {totalEffort}{showEffortUnit ? effortUnit : ''}
          </span>
        )}
      </div>

      {/* PBI list */}
      {groupPbis.length > 0 && (
        <ul className="px-2 py-1 space-y-0.5">
          {groupPbis.map((pbi) => (
            <li key={pbi.system_id} className="flex items-center min-w-0">
              <InlinePBITitle pbi={pbi} projectId={projectId} />
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      {isEditing && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-gray-100">
          <select
            value={group.sprint_index ?? 0}
            onChange={handleMoveSprint}
            className="text-xs border-0 bg-transparent text-gray-500 focus:outline-none cursor-pointer flex-1"
            title="Move to sprint"
          >
            {SPRINT_LABELS.map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleUngroup}
            disabled={deleteGroup.isPending}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 flex-shrink-0"
            title={group.is_implicit ? 'Return to feature zone' : 'Ungroup (PBIs remain)'}
          >
            {group.is_implicit ? 'Unplace' : 'Ungroup'}
          </button>
        </div>
      )}
    </div>
  )
}
