import { useState } from 'react'
import { useUpdatePI } from '@/hooks/usePIs'
import { ConfirmDialog } from './ConfirmDialog'
import type { PI, PIState } from '@/types'
import type { AxiosError } from 'axios'

interface Action {
  label: string
  nextState: PIState
  confirm: string
  destructive?: boolean
}

const ACTIONS: Record<PIState, Action | null> = {
  draft:       { label: 'Start PI',  nextState: 'in_progress', confirm: 'Transition this PI to In Progress?' },
  in_progress: { label: 'Close PI',  nextState: 'closed',      confirm: 'Close this PI? It will become read-only.', destructive: true },
  closed:      null,
}

interface Props {
  readonly pi: PI
  readonly projectId: string
  readonly onError?: (msg: string) => void
}

export function PIStateButton({ pi, projectId, onError }: Props) {
  const [confirming, setConfirming] = useState(false)
  const updatePI = useUpdatePI(projectId)
  const action = ACTIONS[pi.state as PIState]

  if (!action) return null

  const handleConfirm = async () => {
    setConfirming(false)
    try {
      await updatePI.mutateAsync({ piId: pi.system_id, body: { state: action.nextState } })
    } catch (err) {
      const detail = (err as AxiosError<{ detail?: { error?: string; message?: string } }>)
        ?.response?.data?.detail
      onError?.(detail?.message ?? 'State change failed')
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className={`px-3 py-1 text-xs font-medium rounded-md ${
          action.destructive
            ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800'
            : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800'
        }`}
      >
        {action.label}
      </button>
      <ConfirmDialog
        open={confirming}
        title={action.label}
        description={action.confirm}
        confirmLabel={action.label}
        destructive={action.destructive}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
