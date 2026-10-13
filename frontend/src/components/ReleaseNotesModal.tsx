import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { releaseNotesApi } from '@/services/releaseNotes'
import type { ReleaseNoteEntry, ReleaseNoteItem } from '@/types'

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

function NoteList({ items, depth = 0 }: { readonly items: ReleaseNoteItem[]; readonly depth?: number }) {
  return (
    <ul className={`pl-5 space-y-1 ${depth === 0 ? 'list-disc' : 'list-[circle] mt-1'}`}>
      {items.map((item) => (
        <li key={item.text} className="text-sm text-gray-700 dark:text-gray-300">
          {item.text}
          {(item.children?.length ?? 0) > 0 && <NoteList items={item.children ?? []} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

function VersionSection({ entry, defaultOpen }: { readonly entry: ReleaseNoteEntry; readonly defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-gray-200 dark:border-gray-700 last:border-b-0 pb-2">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 py-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          <span aria-hidden className="w-3 text-gray-400">{open ? '▾' : '▸'}</span>
          <span>{entry.version}</span>
          {entry.date && <span className="font-normal text-gray-400 dark:text-gray-500">{entry.date}</span>}
        </button>
      </h3>
      {open && (
        <div className="pl-5 space-y-3">
          {entry.groups.map((group) => (
            <div key={group.title ?? ''}>
              {group.title && (
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  {group.title}
                </h4>
              )}
              <NoteList items={group.items} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
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
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">Release Notes</Dialog.Title>

          <div className="mt-4 overflow-y-auto">
            {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
            {!isLoading && (data?.entries.length ?? 0) === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No release notes yet.</p>
            )}
            {data?.entries.map((entry, index) => (
              <VersionSection key={entry.version} entry={entry} defaultOpen={index === 0} />
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
