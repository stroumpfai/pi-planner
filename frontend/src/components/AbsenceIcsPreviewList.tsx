import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { AbsenceImportCandidate } from '@/types'
import {
  NO_FILTER,
  counts,
  facetCounts,
  shownRows,
  tickedIndices,
  type ImportFilter,
  type ImportRepeats,
  type ImportStatus,
  type ImportWho,
} from '@/utils/absenceIcsFilter'

interface MemberOption {
  readonly system_id: string
  readonly name: string
}

interface Props {
  readonly candidates: readonly AbsenceImportCandidate[]
  readonly members: readonly MemberOption[]
  /** Team mode: rows carry a member dropdown, and the toolbar a member filter. */
  readonly matchByName: boolean
  readonly ticked: Readonly<Record<number, boolean>>
  readonly assigned: Readonly<Record<number, string>>
  readonly onTick: (changes: Record<number, boolean>) => void
  readonly onAssign: (index: number, memberId: string) => void
  readonly filter: ImportFilter
  readonly onFilter: (filter: ImportFilter) => void
  readonly excludeWords: readonly string[]
  /** Rendered in the scrolling area under the events: removals and skips. */
  readonly children?: ReactNode
}

const STATUS_LABEL: Record<ImportStatus, string> = { create: 'New', update: 'Update', unchanged: 'Unchanged' }
const REPEATS_LABEL: Record<ImportRepeats, string> = { single: 'Single', weekly: 'Weekly', yearly: 'Yearly' }
const WHO_LABEL: Record<ImportWho, string> = { matched: 'Matched', unmatched: 'Unmatched', all: 'All' }
const INPUT = 'block rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-sm'

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/**
 * The events of an `.ics` preview, with the tools a long file needs (teams.md §7.4.1).
 *
 * **Filters show; they never untick.** A row a filter hides keeps its tick and
 * is still imported — the dialog's footer counts those, so nothing is sent by
 * surprise. The two bulk buttons are the exception that proves it: they act on
 * exactly the rows on screen, which is what makes "search *birthday*, Deselect
 * 12 shown" safe in a file of four hundred events.
 *
 * Laid out as a fixed toolbar over a scrolling list, so the controls stay in
 * reach however far down the file the reader has gone.
 */
export function AbsenceIcsPreviewList({
  candidates,
  members,
  matchByName,
  ticked,
  assigned,
  onTick,
  onAssign,
  filter,
  onFilter,
  excludeWords,
  children,
}: Props) {
  const nameOf = (id: string) => members.find((m) => m.system_id === id)?.name ?? '—'
  const choices = { ticked, assigned }
  const shown = shownRows(candidates, choices, filter, excludeWords, nameOf)
  const summary = useMemo(() => counts(candidates, excludeWords), [candidates, excludeWords])
  // Each chip counts what pressing it would show, under every other filter.
  const facets = facetCounts(candidates, choices, filter, excludeWords, nameOf)
  const shownTicked = shown.filter((i) => ticked[i]).length
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER)

  const all = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // "Some shown rows are ticked" has no attribute; it is a DOM property only.
    if (all.current) all.current.indeterminate = shownTicked > 0 && shownTicked < shown.length
  }, [shownTicked, shown.length])

  const tickShown = (value: boolean) => onTick(Object.fromEntries(shown.map((i) => [i, value])))
  const set = (patch: Partial<ImportFilter>) => onFilter({ ...filter, ...patch })

  const chip = (label: string, count: number | undefined, pressed: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-xs ${
        pressed ? 'bg-blue-600 text-white' : 'bg-band text-gray-600 dark:text-gray-300 hover:bg-band/70'
      }`}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  )

  return (
    <>
      <div className="space-y-2 border-b border-gray-200 dark:border-gray-700 pb-2" role="toolbar" aria-label="Filter events">
        <div className="flex flex-wrap items-end gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="search"
            aria-label="Search events"
            placeholder="Search title or member"
            value={filter.search}
            onChange={(e) => set({ search: e.target.value })}
            className={`${INPUT} min-w-0 flex-1`}
          />
          {matchByName && (
            <select aria-label="Show member" value={filter.memberId} onChange={(e) => set({ memberId: e.target.value })} className={INPUT}>
              <option value="">Everyone</option>
              {members.map((m) => <option key={m.system_id} value={m.system_id}>{m.name}</option>)}
            </select>
          )}
          <label>
            From
            <input type="date" aria-label="Show from" value={filter.from} onChange={(e) => set({ from: e.target.value })} className={INPUT} />
          </label>
          <label>
            To
            <input type="date" aria-label="Show to" value={filter.to} onChange={(e) => set({ to: e.target.value })} className={INPUT} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Only a file with unmatched rows needs the choice; one of three, never none. */}
          {summary.unmatched > 0 && (
            <span role="group" aria-label="Matched to a member" className="mr-1 inline-flex gap-1">
              {(Object.keys(WHO_LABEL) as ImportWho[]).map((who) =>
                chip(WHO_LABEL[who], facets.who[who], filter.who === who, () => set({ who })),
              )}
            </span>
          )}
          {/* A pressed chip stays even at zero, so it can always be released. */}
          {(Object.keys(STATUS_LABEL) as ImportStatus[]).map((status) =>
            facets.status[status] || filter.statuses.includes(status)
              ? chip(STATUS_LABEL[status], facets.status[status] ?? 0, filter.statuses.includes(status), () =>
                  set({ statuses: toggled(filter.statuses, status) }))
              : null,
          )}
          {(Object.keys(REPEATS_LABEL) as ImportRepeats[]).map((kind) =>
            facets.repeats[kind] || filter.repeats.includes(kind)
              ? chip(REPEATS_LABEL[kind], facets.repeats[kind] ?? 0, filter.repeats.includes(kind), () =>
                  set({ repeats: toggled(filter.repeats, kind) }))
              : null,
          )}
          {chip('Ticked only', undefined, filter.tickedOnly !== null, () =>
            set({ tickedOnly: filter.tickedOnly === null ? tickedIndices(choices) : null }))}
          {filtered && (
            <button type="button" onClick={() => onFilter(NO_FILTER)} className="text-xs text-blue-600 hover:underline">
              Clear filters
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input
            ref={all}
            type="checkbox"
            aria-label="Tick every shown event"
            checked={shown.length > 0 && shownTicked === shown.length}
            disabled={shown.length === 0}
            onChange={(e) => tickShown(e.target.checked)}
          />
          <span>{shown.length} of {summary.total - summary.excluded} shown</span>
          <button type="button" onClick={() => tickShown(true)} disabled={shown.length === 0} className="ml-auto text-blue-600 hover:underline disabled:opacity-40">
            Select {shown.length} shown
          </button>
          <button type="button" onClick={() => tickShown(false)} disabled={shown.length === 0} className="text-blue-600 hover:underline disabled:opacity-40">
            Deselect {shown.length} shown
          </button>
        </div>
      </div>

      {/* Never squeezed below a dozen rows: when the settings above take the
          height, the dialog scrolls instead of the list collapsing to nothing. */}
      <div className="min-h-[16rem] flex-1 overflow-y-auto py-2 space-y-4 text-sm">
        <section aria-label="Events">
          {shown.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500">
              {candidates.length === 0 ? 'The file holds no events that can become absences.' : 'No event matches these filters.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {shown.map((i) => {
                const c = candidates[i]
                const member = assigned[i] ?? ''
                return (
                  <li key={i} className="flex items-start gap-2 py-1">
                    <input
                      type="checkbox"
                      aria-label={`Import ${c.title}${c.member_id ? ` for ${nameOf(c.member_id)}` : ''}`}
                      checked={ticked[i] ?? false}
                      onChange={(e) => onTick({ [i]: e.target.checked })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800 dark:text-gray-100">
                        {c.title}
                        {c.action && member === c.member_id && (
                          <span className="ml-2 rounded bg-band px-1.5 text-[10px] uppercase text-gray-500">
                            {STATUS_LABEL[c.action]}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{c.rule_summary}</p>
                      {c.action === 'update' && c.previous && (
                        <p className="text-xs text-gray-400 line-through">{c.previous.summary}</p>
                      )}
                      {c.hint && <p className="text-xs text-gray-400">{c.hint}</p>}
                    </div>
                    {matchByName && (
                      <select
                        aria-label={`Member for ${c.title}`}
                        value={member}
                        onChange={(e) => onAssign(i, e.target.value)}
                        className={`${INPUT} max-w-[10rem] ${ticked[i] && !member ? 'border-amber-500' : ''}`}
                      >
                        <option value="">Choose…</option>
                        {members.map((m) => <option key={m.system_id} value={m.system_id}>{m.name}</option>)}
                      </select>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        {children}
      </div>
    </>
  )
}
