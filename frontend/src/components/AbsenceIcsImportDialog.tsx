import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AbsenceIcsPreviewList } from '@/components/AbsenceIcsPreviewList'
import { useImportAbsenceIcs } from '@/hooks/useAbsences'
import { absenceErrorCode } from '@/services/absences'
import { errorDetail } from '@/services/api'
import type { AbsenceIcsImportResult, AbsenceImportCandidate, AbsenceImportSelection } from '@/types'
import { NO_FILTER, isExcluded, parseExcludeWords, shownRows, type ImportFilter } from '@/utils/absenceIcsFilter'

interface MemberOption {
  readonly system_id: string
  readonly name: string
}

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly members: readonly MemberOption[]
  readonly onClose: () => void
}

type Mode = 'member' | 'match'

const INPUT = 'block rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-sm'

/** Titles that are never leave, as this browser's user wrote them. Per viewer, so not on the server. */
const EXCLUDE_KEY = 'absence-ics-exclude-words'

function loadExcludeText(): string {
  try {
    return localStorage.getItem(EXCLUDE_KEY) ?? ''
  } catch {
    return '' // storage blocked: start empty
  }
}

function saveExcludeText(text: string): void {
  try {
    localStorage.setItem(EXCLUDE_KEY, text)
  } catch {
    // storage blocked: the words last as long as the dialog
  }
}

/**
 * Import absences from an Outlook or Google calendar export (teams.md §7.4.1).
 *
 * **Preview first, and nothing is written until Import.** The preview lists the
 * rows the file would write, the absences it imported before whose event has
 * gone, and what it skipped and why. Every row has a tick: whole days and
 * Outlook "out of office" start ticked; meetings, yearly events (birthdays,
 * mostly) and events nobody matched start unticked.
 *
 * **A file for one person, or for the team.** In team mode each event is
 * matched to members by attendee or by full name in its title. An event nobody
 * matched is hidden behind a filter, and needs a member once ticked: Import
 * stays disabled until it has one, so no leave is lost silently.
 *
 * **Built for long files.** Search, filters and "Select / Deselect N shown" live
 * in `AbsenceIcsPreviewList`. Filters only hide rows; the footer counts the
 * ticked rows they hide. Exclude words ("birthday") are remembered in this
 * browser, and untick and hide every row whose title holds one.
 *
 * **Re-import updates.** Rows remember their event's UID (ADR 0011), so a moved
 * vacation shows as *update*, with the old rule beside the new one.
 *
 * Ticks and member choices are local state: they are a draft of one request,
 * and the server re-checks every one of them against the file on apply.
 */
export function AbsenceIcsImportDialog({ open, teamId, members, onClose }: Props) {
  const importIcs = useImportAbsenceIcs(teamId)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<Mode>('member')
  const [memberId, setMemberId] = useState('')
  const [windowFrom, setWindowFrom] = useState('')
  const [windowTo, setWindowTo] = useState('')
  const [preview, setPreview] = useState<AbsenceIcsImportResult | null>(null)
  // Keyed by the candidate's index: one event naming two members is two rows.
  const [ticked, setTicked] = useState<Record<number, boolean>>({})
  const [assigned, setAssigned] = useState<Record<number, string>>({})
  const [removing, setRemoving] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<ImportFilter>(NO_FILTER)
  const [excludeText, setExcludeText] = useState(loadExcludeText)
  const [error, setError] = useState<string | null>(null)

  const pickedMember = memberId || members[0]?.system_id || ''
  const candidates = useMemo(() => preview?.candidates ?? [], [preview])
  const removals = useMemo(() => preview?.removals ?? [], [preview])
  const excludeWords = useMemo(() => parseExcludeWords(excludeText), [excludeText])
  const nameOf = (id: string | null | undefined) => members.find((m) => m.system_id === id)?.name ?? '—'

  const reset = () => {
    setPreview(null)
    setError(null)
  }

  const close = () => {
    setFile(null)
    setWindowFrom('')
    setWindowTo('')
    setFilter(NO_FILTER)
    reset()
    onClose()
  }

  const options = () => ({
    memberId: mode === 'member' ? pickedMember : undefined,
    windowFrom: windowFrom && windowTo ? windowFrom : undefined,
    windowTo: windowFrom && windowTo ? windowTo : undefined,
  })

  const runPreview = async () => {
    if (!file) return
    setError(null)
    try {
      const result = await importIcs.mutateAsync({ file, options: { ...options(), dryRun: true } })
      const rows = result.candidates ?? []
      setPreview(result)
      setWindowFrom(result.window_from ?? '')
      setWindowTo(result.window_to ?? '')
      setTicked(Object.fromEntries(rows.map((c, i) => [i, c.selected_by_default && !isExcluded(c, excludeWords)])))
      setAssigned(Object.fromEntries(rows.map((c, i) => [i, c.member_id ?? ''])))
      setRemoving(Object.fromEntries(result.removals?.map((r) => [r.system_id, true]) ?? []))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** New words untick what they now hide — a hidden tick would still be imported. */
  const changeExcludeText = (text: string) => {
    setExcludeText(text)
    saveExcludeText(text)
    const words = parseExcludeWords(text)
    const hidden = candidates.flatMap((c, i) => (isExcluded(c, words) ? [[i, false] as const] : []))
    if (hidden.length > 0) setTicked((current) => ({ ...current, ...Object.fromEntries(hidden) }))
  }

  const selections: AbsenceImportSelection[] = useMemo(() => {
    const unique = new Map<string, AbsenceImportSelection>()
    candidates.forEach((c, i) => {
      const member = assigned[i]
      if (ticked[i] && member) unique.set(`${c.source_uid}|${member}`, { source_uid: c.source_uid, member_id: member })
    })
    return [...unique.values()]
  }, [candidates, ticked, assigned])
  const isWrite = (c: AbsenceImportCandidate, i: number) =>
    Boolean(ticked[i] && assigned[i]) && !(c.action === 'unchanged' && assigned[i] === c.member_id)
  const writes = candidates.filter(isWrite).length
  const shown = new Set(shownRows(candidates, { ticked, assigned }, filter, excludeWords, (id) => nameOf(id)))
  const hiddenWrites = candidates.filter((c, i) => isWrite(c, i) && !shown.has(i)).length
  const unassigned = candidates.filter((_, i) => ticked[i] && !assigned[i]).length
  const excluded = candidates.filter((c) => isExcluded(c, excludeWords)).length
  const removalIds = removals.filter((r) => removing[r.system_id]).map((r) => r.system_id)

  const runApply = async () => {
    if (!file || !preview) return
    setError(null)
    try {
      await importIcs.mutateAsync({
        file,
        options: { ...options(), dryRun: false, selections, removals: removalIds },
      })
      close()
    } catch (err) {
      if (absenceErrorCode(err) === 'IMPORT_STALE') setPreview(null)
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[calc(100%-2rem)] max-w-3xl max-h-[90vh] flex flex-col">
          {/* Three bands: a fixed header, a body that scrolls when the screen is
              short, and a footer outside it, so Import is never covered and never
              covers anything. */}
          <div className="shrink-0 px-6 pt-6">
            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Import absences from .ics
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              An Outlook or Google calendar export. Importing an updated file updates what it imported before; absences entered by hand are never touched.
            </Dialog.Description>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-2">
            <div className="mt-4 shrink-0 space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="block">
                  Calendar file
                  <input
                    type="file"
                    accept=".ics,text/calendar"
                    aria-label="Calendar file"
                    className="mt-1 block text-sm"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null)
                      setWindowFrom('')
                      setWindowTo('')
                      setFilter(NO_FILTER)
                      reset()
                    }}
                  />
                </label>

                {/* Who the rows belong to, not which rows are shown: a personal export
                    rarely names its owner and does name colleagues (as attendees), so
                    matching by name would hand its events to the wrong people. */}
                <fieldset className="space-y-1">
                  <legend>Whose calendar is this?</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ics-mode" checked={mode === 'member'} onChange={() => { setMode('member'); reset() }} />
                    One person:
                    <select
                      aria-label="Member"
                      value={pickedMember}
                      disabled={mode !== 'member'}
                      onChange={(e) => { setMemberId(e.target.value); reset() }}
                      className={INPUT}
                    >
                      {members.map((m) => <option key={m.system_id} value={m.system_id}>{m.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ics-mode" checked={mode === 'match'} onChange={() => { setMode('match'); reset() }} />
                    A shared team calendar
                    <span className="text-xs text-gray-500">— events matched to members by attendee or name</span>
                  </label>
                </fieldset>
              </div>

              {/* Shown once a preview has named the file's span; editing it asks for a
                  fresh preview, which reads the file over the new window. */}
              {(preview || windowFrom || windowTo) && (
                <div className="flex flex-wrap items-end gap-3">
                  <label>
                    Remove old imports from
                    <input type="date" aria-label="Window from" value={windowFrom}
                      onChange={(e) => { setWindowFrom(e.target.value); setPreview(null) }} className={`${INPUT} mt-1`} />
                  </label>
                  <label>
                    to
                    <input type="date" aria-label="Window to" value={windowTo}
                      onChange={(e) => { setWindowTo(e.target.value); setPreview(null) }} className={`${INPUT} mt-1`} />
                  </label>
                </div>
              )}

              {preview && (
                <label className="block">
                  Hide titles containing
                  <input
                    type="text"
                    aria-label="Hide titles containing"
                    placeholder="birthday, Geburtstag, anniversary"
                    value={excludeText}
                    onChange={(e) => changeExcludeText(e.target.value)}
                    className={`${INPUT} mt-1 w-full`}
                  />
                  <span className="text-xs text-gray-500">
                    Comma-separated, remembered in this browser.{excluded > 0 ? ` ${excluded} events hidden and unticked.` : ''}
                  </span>
                </label>
              )}
            </div>

            {preview && (
              <div className="mt-3 flex flex-1 flex-col" aria-label="Import preview">
                <AbsenceIcsPreviewList
                  candidates={candidates}
                  members={members}
                  matchByName={mode === 'match'}
                  ticked={ticked}
                  assigned={assigned}
                  onTick={(changes) => setTicked((current) => ({ ...current, ...changes }))}
                  onAssign={(index, member) => setAssigned((current) => ({ ...current, [index]: member }))}
                  filter={filter}
                  onFilter={setFilter}
                  excludeWords={excludeWords}
                >
                  {removals.length > 0 && (
                    <section>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">Will be removed</h3>
                      <p className="text-xs text-gray-500">Imported earlier; their event is no longer in the file.</p>
                      <ul>
                        {removals.map((r) => (
                          <li key={r.system_id} className="flex items-center gap-2 py-1">
                            <input
                              type="checkbox"
                              aria-label={`Remove ${r.label ?? r.summary} for ${nameOf(r.member_id)}`}
                              checked={removing[r.system_id] ?? false}
                              onChange={(e) => setRemoving({ ...removing, [r.system_id]: e.target.checked })}
                            />
                            <span>{nameOf(r.member_id)} · {r.label ?? 'Absence'} · <span className="text-xs text-gray-500">{r.summary}</span></span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {(preview.skipped?.length ?? 0) > 0 && (
                    <details>
                      <summary className="font-medium text-gray-900 dark:text-gray-100">
                        Skipped ({preview.skipped?.length})
                      </summary>
                      <ul className="text-xs text-amber-700 dark:text-amber-400">
                        {preview.skipped?.map((s, i) => <li key={`${s.summary}-${i}`}>{s.summary}: {s.reason}</li>)}
                      </ul>
                    </details>
                  )}
                  {(preview.truncated_labels ?? 0) > 0 && (
                    <p className="text-xs text-gray-500">{preview.truncated_labels} long titles were shortened to 100 characters.</p>
                  )}
                </AbsenceIcsPreviewList>
              </div>
            )}

            {unassigned > 0 && (
              <p className="mt-2 shrink-0 text-xs text-amber-700 dark:text-amber-400">
                Choose a member for {unassigned === 1 ? 'the ticked event' : `${unassigned} ticked events`} that matched nobody, or untick {unassigned === 1 ? 'it' : 'them'}.{' '}
                <button
                  type="button"
                  onClick={() => setFilter({
                    ...NO_FILTER,
                    who: 'all',
                    tickedOnly: candidates.flatMap((_, i) => (ticked[i] && !assigned[i] ? [i] : [])),
                  })}
                  className="underline"
                >
                  Show {unassigned === 1 ? 'it' : 'them'}
                </button>
              </p>
            )}
            {error && <p role="alert" className="mt-3 shrink-0 text-sm text-red-600">{error}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
            {preview && (
              <p className="mr-auto text-xs text-gray-500" aria-live="polite">
                {writes} to write{hiddenWrites > 0 ? ` (${hiddenWrites} hidden by filters)` : ''} · {removalIds.length} to remove
              </p>
            )}
            <button type="button" onClick={close} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
              Cancel
            </button>
            {preview ? (
              <button
                type="button"
                onClick={runApply}
                disabled={importIcs.isPending || unassigned > 0 || writes + removalIds.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                Import
              </button>
            ) : (
              <button
                type="button"
                onClick={runPreview}
                disabled={importIcs.isPending || !file || (mode === 'member' && !pickedMember)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                Preview
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function errorMessage(err: unknown): string {
  return errorDetail(err)?.message ?? 'Could not read that file.'
}
