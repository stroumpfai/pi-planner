import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { useCreateAbsences, useUpdateAbsence } from '@/hooks/useAbsences'
import { absenceErrorCode, staleAbsence } from '@/services/absences'
import { errorDetail } from '@/services/api'
import {
  Field,
  FAR_FUTURE_YEARS,
  KindTabs,
  inputClass,
  isFarFuture,
} from '@/components/scheduleForm'
import type { Absence, AbsenceCreate, ScheduleKind, TeamMember } from '@/types'
import { previewOccurrences, weekdayIndex } from '@/utils/absenceGrid'
import { WEEKDAY_LABELS, WEEKDAYS, type Half } from '@/utils/workingDays'

/** The draft a drag across the grid hands over — never written without review. */
export interface AbsenceDraft {
  readonly memberIds: readonly string[]
  readonly from: string
  readonly to: string
  readonly startHalf: Half
  readonly endHalf: Half
}

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly members: readonly TeamMember[]
  /** The window the grid is showing, so the saved row comes back expanded for it. */
  readonly window: { readonly from: string; readonly to: string }
  /** Pre-fill from a drag, or from the "+ Add absence" button's empty draft. */
  readonly draft?: AbsenceDraft | null
  /** The entry being edited. Its member is fixed: moving one is a delete and a create. */
  readonly editing?: Absence | null
  readonly onClose: () => void
  /**
   * A 412 while saving an edit: the row moved under this form.
   *
   * Handed up rather than shown here, because the choice it needs — keep theirs,
   * or reapply mine — belongs beside the grid that now shows theirs, and a
   * dialog that stays open over it would hide the very thing being compared
   * (§4.2).
   */
  readonly onStale?: (mine: Absence, theirs: Absence) => void
}

const KIND_HINTS: Readonly<Record<ScheduleKind, string>> = {
  range: 'A block of consecutive days — a holiday, or one public holiday',
  weekly: 'The same slot every week',
  interval: 'The same slot every N weeks — a 90% contract’s free Friday',
}

type HalvesChoice = 'am' | 'pm' | 'both'

const halvesOf = (choice: HalvesChoice): Half[] => (choice === 'both' ? ['am', 'pm'] : [choice])

/**
 * Add or edit an absence (teams.md §3.4; design 3a · 4a · 4b).
 *
 * **Wider than the app's `max-w-md`, deliberately.** The member column is the
 * reason: selecting everyone is one click, and that click is how a public
 * holiday is entered. Squeezing the checklist under the fields would bury the
 * feature the view exists for.
 *
 * **Three kinds, three tabs.** `interval` is its own kind rather than a number on
 * `weekly`, so the ordinary weekly case has nothing extra to fill in. Its anchor
 * is labelled **First occurrence**, not "runs from" — it decides *which*
 * alternate weeks are hit, and naming it as a boundary invites someone to type
 * the first of the month and get the wrong fortnight. The occurrence chips
 * beneath it are the check: an off-by-one week is invisible in the rule and
 * obvious in the dates.
 *
 * **No "this occurrence / the whole series".** Editing always acts on the series;
 * there are no per-occurrence exceptions in the model, and offering the choice
 * here would promise something the backend cannot store (§3.4).
 */
export function AbsenceDialog({
  open,
  teamId,
  members,
  window,
  draft,
  editing,
  onClose,
  onStale,
}: Props) {
  const create = useCreateAbsences(teamId, window.from, window.to)
  const update = useUpdateAbsence(teamId, window.from, window.to)

  const [memberIds, setMemberIds] = useState<string[]>([])
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('range')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startHalf, setStartHalf] = useState<Half>('am')
  const [endHalf, setEndHalf] = useState<Half>('pm')
  const [weekday, setWeekday] = useState(0)
  const [halves, setHalves] = useState<HalvesChoice>('both')
  const [intervalWeeks, setIntervalWeeks] = useState(2)
  const [error, setError] = useState<string | null>(null)
  const [farFutureAccepted, setFarFutureAccepted] = useState(false)

  // Re-seeded whenever the dialog opens on something new, so a second drag never
  // shows the first one's dates.
  useEffect(() => {
    if (!open) return
    setError(null)
    setFarFutureAccepted(false)
    if (editing) {
      setMemberIds([editing.member_id])
      setLabel(editing.label ?? '')
      setKind(editing.kind as ScheduleKind)
      setStartDate(editing.start_date)
      setEndDate(editing.end_date ?? '')
      setStartHalf((editing.start_half as Half) ?? 'am')
      setEndHalf((editing.end_half as Half) ?? 'pm')
      setWeekday(editing.weekday ?? weekdayIndex(editing.start_date))
      const stored = editing.halves ?? ['am', 'pm']
      setHalves(stored.length === 2 ? 'both' : (stored[0] as HalvesChoice))
      setIntervalWeeks(editing.interval_weeks ?? 2)
      return
    }
    setMemberIds(draft ? [...draft.memberIds] : [])
    setLabel('')
    setKind('range')
    setStartDate(draft?.from ?? '')
    setEndDate(draft?.to ?? '')
    setStartHalf(draft?.startHalf ?? 'am')
    setEndHalf(draft?.endHalf ?? 'pm')
    setWeekday(draft ? weekdayIndex(draft.from) : 0)
    setHalves('both')
    setIntervalWeeks(2)
  }, [open, draft, editing])

  // A sanity check, never a horizon: absences may be entered years ahead, and a
  // date past ten is almost always a typo'd year. So it asks, and then allows
  // (§7.4).
  const farFuture = isFarFuture(startDate) || isFarFuture(endDate)

  const chips = useMemo(
    () =>
      kind === 'interval'
        ? previewOccurrences(startDate, weekday, intervalWeeks, 5, endDate || null)
        : [],
    [kind, startDate, weekday, intervalWeeks, endDate],
  )

  const summary = describeDraft({
    kind,
    startDate,
    endDate,
    startHalf,
    endHalf,
    weekday,
    halves,
    intervalWeeks,
    memberCount: memberIds.length,
  })

  const toggleMember = (id: string) =>
    setMemberIds((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    )

  const allSelected = members.length > 0 && memberIds.length === members.length

  const body = (): Omit<AbsenceCreate, 'member_ids'> => ({
    kind,
    label: label.trim() || null,
    start_date: startDate,
    end_date: endDate || null,
    start_half: kind === 'range' ? startHalf : 'am',
    end_half: kind === 'range' ? endHalf : 'pm',
    weekday: kind === 'range' ? null : weekday,
    halves: kind === 'range' ? null : halvesOf(halves),
    interval_weeks: kind === 'interval' ? intervalWeeks : null,
  })

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (memberIds.length === 0) {
      setError('Choose at least one person.')
      return
    }
    if (!startDate) {
      setError(kind === 'range' ? 'A start date is required.' : 'A first occurrence date is required.')
      return
    }
    if (endDate && endDate < startDate) {
      setError('The end date cannot fall before the start.')
      return
    }
    if (farFuture && !farFutureAccepted) {
      setFarFutureAccepted(true)
      setError(
        `That date is more than ${FAR_FUTURE_YEARS} years away — check the year. Save again to keep it.`,
      )
      return
    }

    try {
      if (editing) {
        await update.mutateAsync({
          absenceId: editing.system_id,
          etag: editing.etag ?? '',
          body: body(),
        })
      } else {
        await create.mutateAsync({ ...body(), member_ids: memberIds })
      }
      onClose()
    } catch (err) {
      const theirs = staleAbsence(err)
      if (theirs && editing) {
        // Nothing was written. Hand both versions up and get out of the way —
        // never a spinner, never a silent refetch (§4.2).
        onStale?.({ ...editing, ...body(), summary }, theirs)
        onClose()
        return
      }
      const code = absenceErrorCode(err)
      if (code === 'STALE') {
        setError('This entry changed while you had it open. Close and reopen it to see the current values.')
      } else if (code === 'ABSENCE_LIMIT_REACHED' || code === 'INVALID_SCHEDULE') {
        setError(errorDetail(err)?.message ?? 'That schedule cannot be saved.')
      } else {
        setError('Could not save that — please try again.')
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {editing ? 'Edit absence' : 'Add absence'}
          </Dialog.Title>

          <form onSubmit={onSubmit} className="mt-4 flex flex-col sm:flex-row gap-5">
            <fieldset className="sm:w-[186px] shrink-0">
              <legend className="text-xs font-medium text-gray-500 dark:text-gray-400 flex w-full items-center gap-2">
                Who
                {!editing && members.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMemberIds(allSelected ? [] : members.map((m) => m.system_id))}
                    className="ml-auto text-[11px] text-blue-600 hover:underline"
                  >
                    {allSelected ? 'none' : `all ${members.length}`}
                  </button>
                )}
              </legend>
              {/* One click for everyone is the public-holiday flow, and the whole
                  reason this dialog is wider than the app's others (§3.4). */}
              <div className="mt-2 rounded-lg bg-band shadow-soft-inset p-2 max-h-56 overflow-y-auto space-y-1">
                {members.map((member) => (
                  <label
                    key={member.system_id}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <input
                      type="checkbox"
                      disabled={Boolean(editing)}
                      checked={memberIds.includes(member.system_id)}
                      onChange={() => toggleMember(member.system_id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                    />
                    <span className="truncate">{member.name}</span>
                  </label>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-gray-400">Nobody on this team yet.</p>
                )}
              </div>
              {editing && (
                <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  An absence belongs to one person. Moving it is a delete and a create.
                </p>
              )}
            </fieldset>

            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <label htmlFor="absence-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Label <span className="text-xs font-normal text-gray-400">optional, for humans only</span>
                </label>
                <input
                  id="absence-label"
                  name="label"
                  value={label}
                  maxLength={100}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Christmas"
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>

              <KindTabs
                label="Absence kind"
                value={kind}
                onChange={setKind}
                hints={KIND_HINTS}
              />

              {kind === 'range' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor="absence-from">
                    <div className="flex gap-2">
                      <DateInput id="absence-from" value={startDate} onChange={setStartDate} className={inputClass} />
                      <HalfSelect
                        id="absence-from-half"
                        label="Starting half"
                        value={startHalf}
                        onChange={setStartHalf}
                      />
                    </div>
                  </Field>
                  <Field label="To" htmlFor="absence-to" hint="inclusive">
                    <div className="flex gap-2">
                      <DateInput id="absence-to" value={endDate} onChange={setEndDate} className={inputClass} />
                      <HalfSelect id="absence-to-half" label="Ending half" value={endHalf} onChange={setEndHalf} />
                    </div>
                  </Field>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {kind === 'interval' && (
                      <Field label="Every" htmlFor="absence-interval" hint="weeks">
                        <input
                          id="absence-interval"
                          type="number"
                          min={2}
                          max={52}
                          value={intervalWeeks}
                          onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                          className={inputClass}
                        />
                      </Field>
                    )}
                    <Field label="Weekday" htmlFor="absence-weekday">
                      <select
                        id="absence-weekday"
                        value={weekday}
                        onChange={(e) => setWeekday(Number(e.target.value))}
                        className={inputClass}
                      >
                        {WEEKDAYS.map((day, index) => (
                          <option key={day} value={index}>{WEEKDAY_LABELS[day]}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Halves" htmlFor="absence-halves">
                      <select
                        id="absence-halves"
                        value={halves}
                        onChange={(e) => setHalves(e.target.value as HalvesChoice)}
                        className={inputClass}
                      >
                        <option value="am">am</option>
                        <option value="pm">pm</option>
                        <option value="both">both</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={kind === 'interval' ? 'First occurrence' : 'Runs from'}
                      htmlFor="absence-anchor"
                      hint={kind === 'interval' ? 'the anchor — it picks the weeks' : undefined}
                    >
                      <DateInput id="absence-anchor" value={startDate} onChange={setStartDate} className={inputClass} />
                    </Field>
                    <Field label="Until" htmlFor="absence-until" hint="empty = open-ended">
                      <DateInput id="absence-until" value={endDate} onChange={setEndDate} className={inputClass} />
                    </Field>
                  </div>
                  {kind === 'interval' && chips.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Occurrences</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {chips.map((day) => (
                          <span
                            key={day}
                            className="px-2 py-0.5 rounded-md bg-band shadow-soft-inset text-[11px] text-gray-600 dark:text-gray-300"
                          >
                            {day}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="absence-summary">
                → {summary}
              </p>

              {error && (
                <p
                  role="alert"
                  className={`text-xs ${farFuture && farFutureAccepted ? 'text-amber-600 dark:text-amber-400' : 'text-red-600'}`}
                >
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={create.isPending || update.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface HalfSelectProps {
  readonly id: string
  readonly label: string
  readonly value: Half
  readonly onChange: (half: Half) => void
}

function HalfSelect({ id, label, value, onChange }: HalfSelectProps) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Half)}
      className={`${inputClass} w-20`}
    >
      <option value="am">am</option>
      <option value="pm">pm</option>
    </select>
  )
}

interface DraftSummary {
  readonly kind: ScheduleKind
  readonly startDate: string
  readonly endDate: string
  readonly startHalf: Half
  readonly endHalf: Half
  readonly weekday: number
  readonly halves: HalvesChoice
  readonly intervalWeeks: number
  readonly memberCount: number
}

/**
 * The rule in plain language, before it is saved.
 *
 * Deliberately says what it *costs*, not only what it is: "12 half-days removed
 * from capacity" is the sentence that catches a mis-set end date, which the
 * dates alone do not.
 */
export function describeDraft(draft: DraftSummary): string {
  const people = draft.memberCount === 1 ? '1 person' : `${draft.memberCount} people`
  if (!draft.startDate) return 'pick a date to see what this removes'

  if (draft.kind === 'range') {
    const last = draft.endDate || draft.startDate
    const span = last === draft.startDate ? draft.startDate : `${draft.startDate} – ${last}`
    const halves =
      last === draft.startDate && draft.startHalf === draft.endHalf
        ? `${draft.startHalf} only`
        : last === draft.startDate
          ? 'both halves'
          : `${draft.startHalf} to ${draft.endHalf}`
    return `${span}, ${halves}, ${people}`
  }

  const dayLabel = WEEKDAY_LABELS[WEEKDAYS[draft.weekday]]
  const halves = draft.halves === 'both' ? 'both halves' : draft.halves
  const every = draft.kind === 'interval' ? `every ${draft.intervalWeeks} weeks on ${dayLabel}` : `every ${dayLabel}`
  const until = draft.endDate ? `until ${draft.endDate}` : 'ongoing'
  return `${every}, ${halves}, from ${draft.startDate} ${until}, ${people}`
}
