import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useImportAbsenceIcs } from '@/hooks/useAbsences'
import { absenceErrorCode } from '@/services/absences'
import { errorDetail } from '@/services/api'
import type { AbsenceIcsImportResult, AbsenceImportCandidate, AbsenceImportSelection } from '@/types'

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

const ACTION_LABEL: Record<NonNullable<AbsenceImportCandidate['action']>, string> = {
  create: 'new',
  update: 'update',
  unchanged: 'unchanged',
}

const INPUT = 'block rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-sm'

/**
 * Import absences from an Outlook or Google calendar export (teams.md §7.4.1).
 *
 * **Preview first, and nothing is written until Import.** The preview lists the
 * rows the file would write, the absences it imported before whose event has
 * gone, and what it skipped and why. Every row has a tick: whole days and
 * Outlook "out of office" start ticked, other timed events — meetings, mostly —
 * start unticked.
 *
 * **A file for one person, or for the team.** In team mode each event is
 * matched to members by attendee or by full name in its title, and an event
 * nobody matched keeps its tick with an empty member: Import stays disabled
 * until someone is picked or the row is unticked, so no leave is lost silently.
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
  const [error, setError] = useState<string | null>(null)

  const pickedMember = memberId || members[0]?.system_id || ''
  const candidates = useMemo(() => preview?.candidates ?? [], [preview])
  const removals = useMemo(() => preview?.removals ?? [], [preview])
  const nameOf = (id: string | null | undefined) => members.find((m) => m.system_id === id)?.name ?? '—'

  const reset = () => {
    setPreview(null)
    setError(null)
  }

  const close = () => {
    setFile(null)
    setWindowFrom('')
    setWindowTo('')
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
      setPreview(result)
      setWindowFrom(result.window_from ?? '')
      setWindowTo(result.window_to ?? '')
      setTicked(Object.fromEntries(result.candidates?.map((c, i) => [i, c.selected_by_default]) ?? []))
      setAssigned(Object.fromEntries(result.candidates?.map((c, i) => [i, c.member_id ?? '']) ?? []))
      setRemoving(Object.fromEntries(result.removals?.map((r) => [r.system_id, true]) ?? []))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const selections: AbsenceImportSelection[] = useMemo(() => {
    const unique = new Map<string, AbsenceImportSelection>()
    candidates.forEach((c, i) => {
      const member = assigned[i]
      if (ticked[i] && member) unique.set(`${c.source_uid}|${member}`, { source_uid: c.source_uid, member_id: member })
    })
    return [...unique.values()]
  }, [candidates, ticked, assigned])
  const unassigned = candidates.filter((_, i) => ticked[i] && !assigned[i]).length
  const removalIds = removals.filter((r) => removing[r.system_id]).map((r) => r.system_id)
  const writes = candidates.filter((c, i) => ticked[i] && assigned[i] && !(c.action === 'unchanged' && assigned[i] === c.member_id)).length

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

  const changed = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.action !== 'unchanged')
  const unchanged = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.action === 'unchanged')

  const row = ({ c, i }: { c: AbsenceImportCandidate; i: number }) => (
    <li key={i} className="flex items-start gap-2 py-1">
      <input
        type="checkbox"
        aria-label={`Import ${c.title}${c.member_id ? ` for ${nameOf(c.member_id)}` : ''}`}
        checked={ticked[i] ?? false}
        onChange={(e) => setTicked({ ...ticked, [i]: e.target.checked })}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <p className="text-gray-800 dark:text-gray-100">
          {c.title}
          {c.action && assigned[i] === c.member_id && (
            <span className="ml-2 rounded bg-band px-1.5 text-[10px] uppercase text-gray-500">{ACTION_LABEL[c.action]}</span>
          )}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{c.rule_summary}</p>
        {c.action === 'update' && c.previous && (
          <p className="text-xs text-gray-400 line-through">{c.previous.summary}</p>
        )}
        {c.hint && <p className="text-xs text-gray-400">{c.hint}</p>}
      </div>
      {mode === 'match' && (
        <select
          aria-label={`Member for ${c.title}`}
          value={assigned[i] ?? ''}
          onChange={(e) => setAssigned({ ...assigned, [i]: e.target.value })}
          className={`${INPUT} max-w-[10rem] ${ticked[i] && !assigned[i] ? 'border-amber-500' : ''}`}
        >
          <option value="">Choose…</option>
          {members.map((m) => <option key={m.system_id} value={m.system_id}>{m.name}</option>)}
        </select>
      )}
    </li>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Import absences from .ics
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            An Outlook or Google calendar export. Importing an updated file updates what it imported before; absences entered by hand are never touched.
          </Dialog.Description>

          <div className="mt-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
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
                  reset()
                }}
              />
            </label>

            <fieldset className="space-y-1">
              <legend className="sr-only">Whose absences</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="ics-mode" checked={mode === 'member'} onChange={() => { setMode('member'); reset() }} />
                One member
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
                Match events to members by name
              </label>
            </fieldset>

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
          </div>

          {preview && (
            <div className="mt-4 space-y-4 text-sm" aria-label="Import preview">
              <section>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">Events</h3>
                {candidates.length === 0 ? (
                  <p className="text-xs text-gray-500">The file holds no events that can become absences.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">{changed.map(row)}</ul>
                )}
                {unchanged.length > 0 && (
                  <details className="mt-1 text-xs text-gray-500">
                    <summary>{unchanged.length} unchanged</summary>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">{unchanged.map(row)}</ul>
                  </details>
                )}
              </section>

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
                <section>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">Skipped</h3>
                  <ul className="text-xs text-amber-700 dark:text-amber-400">
                    {preview.skipped?.map((s, i) => <li key={`${s.summary}-${i}`}>{s.summary}: {s.reason}</li>)}
                  </ul>
                </section>
              )}
              {(preview.truncated_labels ?? 0) > 0 && (
                <p className="text-xs text-gray-500">{preview.truncated_labels} long titles were shortened to 100 characters.</p>
              )}
              {unassigned > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Choose a member for {unassigned === 1 ? 'the ticked event' : `${unassigned} ticked events`} that matched nobody, or untick {unassigned === 1 ? 'it' : 'them'}.
                </p>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-6 flex items-center justify-end gap-3">
            {preview && (
              <p className="mr-auto text-xs text-gray-500">
                {writes} to write · {removalIds.length} to remove
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
