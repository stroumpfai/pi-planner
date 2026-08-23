import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { usePIs } from '@/hooks/usePIs'
import { useSwimlinesForPI } from '@/hooks/useSwimlinesAndGroups'
import { useSplitFeature } from '@/hooks/useFeatures'

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly featureId: string
  readonly currentPiId: string | null
  readonly pbiIds: string[]
  readonly onClose: () => void
}

export function SplitFeatureModal({ open, projectId, featureId, currentPiId, pbiIds, onClose }: Props) {
  const [targetPiId, setTargetPiId] = useState('')
  const [targetSwimlineId, setTargetSwimlineId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: pis = [] } = usePIs(projectId)
  const { data: swimlines = [] } = useSwimlinesForPI(targetPiId)
  const split = useSplitFeature(projectId)

  const candidatePIs = pis.filter((pi) => pi.system_id !== currentPiId)

  useEffect(() => {
    if (open) {
      setTargetPiId('')
      setTargetSwimlineId('')
      setError(null)
    }
  }, [open])

  useEffect(() => {
    setTargetSwimlineId('')
  }, [targetPiId])

  function handleClose() {
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await split.mutateAsync({
        featureId,
        body: { target_pi_id: targetPiId, target_swimline_id: targetSwimlineId, pbi_ids: pbiIds },
      })
      handleClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail?.message
      setError(msg ?? 'Failed to move PBIs')
    }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-80">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Move to PI
          </Dialog.Title>
          <Dialog.Description className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {pbiIds.length} PBI{pbiIds.length === 1 ? '' : 's'} will move to the target PI, unsprinted.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="split-target-pi" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Target PI <span className="text-red-500">*</span>
              </label>
              <select
                id="split-target-pi"
                value={targetPiId}
                onChange={(e) => setTargetPiId(e.target.value)}
                required
                autoFocus
                className={inputClass}
              >
                <option value="" disabled>Select a PI…</option>
                {candidatePIs.map((pi) => (
                  <option key={pi.system_id} value={pi.system_id}>{pi.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="split-target-swimline" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Target Swimline <span className="text-red-500">*</span>
              </label>
              <select
                id="split-target-swimline"
                value={targetSwimlineId}
                onChange={(e) => setTargetSwimlineId(e.target.value)}
                required
                disabled={!targetPiId}
                className={inputClass}
              >
                <option value="" disabled>Select a swimline…</option>
                {swimlines.map((sl) => (
                  <option key={sl.system_id} value={sl.system_id}>{sl.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!targetPiId || !targetSwimlineId || split.isPending}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {split.isPending ? 'Moving…' : `Move ${pbiIds.length} PBI${pbiIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
