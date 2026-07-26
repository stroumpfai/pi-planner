import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useCreatePIEvent, useDeletePIEvent, useUpdatePIEvent } from '@/hooks/usePIEvents'
import { DateInput } from './DateInput'
import { EVENT_TYPE_OPTIONS } from '@/utils/piEvents'
import type { PIEvent, PIEventType } from '@/types'

interface Props {
  readonly open: boolean
  readonly piId: string
  readonly event?: PIEvent
  readonly onClose: () => void
}

export function PIEventModal({ open, piId, event, onClose }: Props) {
  const isEdit = !!event

  const [name, setName] = useState(event?.name ?? '')
  const [date, setDate] = useState(event?.event_date ?? '')
  const [type, setType] = useState<PIEventType>(event?.event_type ?? 'milestone')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setName(event?.name ?? '')
      setDate(event?.event_date ?? '')
      setType(event?.event_type ?? 'milestone')
      setError(null)
      setConfirmDelete(false)
    }
    // Re-sync the form only when the modal opens or a different event is loaded,
    // not on every field change — otherwise in-progress edits would be clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.system_id])

  const create = useCreatePIEvent(piId)
  const update = useUpdatePIEvent(piId)
  const del = useDeletePIEvent(piId)

  function reset() {
    setName(event?.name ?? '')
    setDate(event?.event_date ?? '')
    setType(event?.event_type ?? 'milestone')
    setError(null)
    setConfirmDelete(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!date) { setError('Date is required'); return }
    setError(null)
    try {
      if (isEdit) {
        await update.mutateAsync({ eventId: event.system_id, body: { name: name.trim(), event_date: date, event_type: type } })
      } else {
        await create.mutateAsync({ name: name.trim(), event_date: date, event_type: type })
      }
      handleClose()
    } catch {
      setError('Failed to save event')
    }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await del.mutateAsync(event!.system_id)
      handleClose()
    } catch {
      setError('Failed to delete event')
    }
  }

  const isPending = create.isPending || update.isPending || del.isPending
  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-80">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {isEdit ? 'Edit Event' : 'Add Event'}
          </Dialog.Title>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="event-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Name
              </label>
              <input
                id="event-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="e.g. Release v2.0"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="event-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date
              </label>
              <DateInput
                id="event-date"
                value={date}
                onChange={setDate}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="event-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Type
              </label>
              <select
                id="event-type"
                value={type}
                onChange={(e) => setType(e.target.value as PIEventType)}
                className={inputClass}
              >
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex items-center justify-between pt-1">
              {isEdit ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {confirmDelete ? 'Confirm delete?' : 'Delete'}
                </button>
              ) : <span />}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
