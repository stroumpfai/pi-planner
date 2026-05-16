import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useCreateGroup } from '@/hooks/useSwimlinesAndGroups'

interface Props {
  readonly open: boolean
  readonly swimlaneId: string
  readonly featureId: string
  readonly pbiIds: string[]
  readonly piId: string
  readonly onClose: () => void
}

const SPRINT_LABELS = ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'Sprint 5']

export function CreateGroupModal({ open, swimlaneId, featureId, pbiIds, onClose }: Props) {
  const [name, setName] = useState('')
  const [sprintIndex, setSprintIndex] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const create = useCreateGroup(swimlaneId)

  function handleClose() {
    setName('')
    setSprintIndex(0)
    setError(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({
        name: name.trim(),
        feature_system_id: featureId,
        pbi_ids: pbiIds,
        sprint_index: sprintIndex,
      })
      handleClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail?.message
      setError(msg ?? 'Failed to create group')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-lg shadow-xl p-6 w-80">
          <Dialog.Title className="text-base font-semibold text-gray-900 mb-1">New Group</Dialog.Title>
          {pbiIds.length > 0 && (
            <p className="text-xs text-gray-500 mb-4">{pbiIds.length} PBI{pbiIds.length === 1 ? '' : 's'} will be added</p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                autoFocus
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Authentication"
              />
            </div>

            <div>
              <label htmlFor="group-sprint" className="block text-sm font-medium text-gray-700 mb-1">
                Sprint
              </label>
              <select
                id="group-sprint"
                value={sprintIndex}
                onChange={(e) => setSprintIndex(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SPRINT_LABELS.map((label, i) => (
                  <option key={label} value={i}>{label}</option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || create.isPending}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
