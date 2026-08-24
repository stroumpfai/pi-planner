import { useEffect } from 'react'
import { useAcquireEditLock, useEditLock, useKeepaliveEditLock, useReleaseEditLock } from '@/hooks/useEditLock'
import { useAuthStore } from '@/stores/authStore'

interface Props {
  readonly projectId: string
}

const HEARTBEAT_MS = 60_000 // 1 minute

export function EditLockButton({ projectId }: Props) {
  const { data: lock } = useEditLock(projectId)
  const acquire = useAcquireEditLock(projectId)
  const release = useReleaseEditLock(projectId)
  const keepalive = useKeepaliveEditLock(projectId)
  const { user, isEditing } = useAuthStore()

  // Heartbeat: send keepalive every minute while editing.
  // Depend on `keepalive.mutate` (stable) rather than the mutation result object,
  // which React Query rebuilds on every render — including the one `useEditLock`'s
  // 30s refetch triggers. Depending on the object restarted the 60s interval
  // before it could ever fire, so the lock silently expired mid-edit.
  const keepaliveMutate = keepalive.mutate
  useEffect(() => {
    if (!isEditing) return
    const id = setInterval(() => keepaliveMutate(), HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [isEditing, keepaliveMutate])

  if (!user) return null

  const lockedByOther = lock?.is_locked && lock.locked_by_username !== user.username

  if (user.role === 'reader') {
    if (lockedByOther) {
      return (
        <span className="inline-flex items-center gap-1 text-sm text-amber-700">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Locked by {lock?.locked_by_username}
        </span>
      )
    }
    return null
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-sm text-green-700 font-medium">
          <span className="h-2 w-2 rounded-full bg-green-500" />{' '}You • Editor
        </span>
        <button
          onClick={() => release.mutate()}
          disabled={release.isPending}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Release
        </button>
      </div>
    )
  }

  if (lockedByOther) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Locked by {lock?.locked_by_username}
      </span>
    )
  }

  return (
    <button
      onClick={() => acquire.mutate()}
      disabled={acquire.isPending}
      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
    >
      {acquire.isPending ? 'Requesting…' : 'Request Edit Mode'}
    </button>
  )
}
