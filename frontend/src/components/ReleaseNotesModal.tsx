import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { releaseNotesApi } from '@/services/releaseNotes'

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

export function ReleaseNotesModal({ open, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['release-notes'],
    queryFn: releaseNotesApi.list,
    enabled: open,
  })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[70vh] flex flex-col"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">Release Notes</Dialog.Title>

          <div className="mt-4 overflow-y-auto space-y-5">
            {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
            {!isLoading && (data?.entries.length ?? 0) === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No release notes yet.</p>
            )}
            {data?.entries.map((entry) => (
              <div key={entry.version}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {entry.version}
                  {entry.date && <span className="ml-2 font-normal text-gray-400 dark:text-gray-500">{entry.date}</span>}
                </h3>
                <ul className="mt-1.5 list-disc pl-5 space-y-1">
                  {entry.notes.map((note) => (
                    <li key={note} className="text-sm text-gray-700 dark:text-gray-300">{note}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4 mt-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
