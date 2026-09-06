import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import {
  FAR_FUTURE_YEARS,
  Field,
  KindTabs,
  inputClass,
  isFarFuture,
} from '@/components/scheduleForm'
import { useCreateMeeting, useUpdateMeeting } from '@/hooks/useMeetings'
import { errorDetail } from '@/services/api'
import { attendeesOf, meetingErrorCode, staleMeeting } from '@/services/meetings'
import type { Meeting, MeetingCreate, ScheduleKind, TeamMember } from '@/types'
import { previewOccurrences, weekdayIndex } from '@/utils/absenceGrid'
import { WEEKDAY_LABELS, WEEKDAYS, type Half } from '@/utils/workingDays'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly members: readonly TeamMember[]
  /** The window the matrix is counting in, so the saved row comes back expanded. */
  readonly window: { readonly from: string; readonly to: string }
  /** The meeting being edited, or null to add one. */
  readonly editing?: Meeting | null
  readonly onClose: () => void
  /**
   * A 412 while saving: the row moved under this form.
   *
   * Handed up rather than shown here, because the choice it needs — keep theirs,
   * or reapply mine — belongs beside the matrix that now shows theirs, and a
   * dialog sitting over it would hide the very thing being compared (§4.2).
   */
  readonly onStale?: (mine: Meeting, theirs: Meeting) => void
}

const KIND_HINTS: Readonly<Record<ScheduleKind, string>> = {
  range: 'A one-off, or a block of days — each day costs the full duration',
  weekly: 'The same slot every week — a stand-up',
  interval: 'The same slot every N weeks — a fortnightly retro',
}

/** §9: 5–480 minutes in steps of 5. The shortcuts are what people actually book. */
const DURATIONS: readonly number[] = [15, 30, 45, 60, 90, 120, 240, 480]

export const MIN_DURATION = 5
export const MAX_DURATION = 480

/**
 * Add or edit a meeting (teams.md §3.5; design 1g).
 *
 * The same three kinds and the same anchor rules as an absence — one rule shape,
 * one modal, one occurrence generator — plus the three things only a meeting has:
 *
 * **A duration in minutes, not a half-day.** A 15-minute stand-up and a full
 * planning day are both meetings, and rounding both to a half-day makes the
 * number useless. The length is the meeting's own and is deliberately not capped
 * by the attendee's contract: an 8 h workshop is enterable for a 6 h/day member.
 *
 * **A half-day it *starts* in, not one it is confined to.** Anything longer
 * spills into the rest of that day. Placement is kept because it is what lets a
 * meeting be cancelled against an absence — a morning meeting for someone who is
 * away that morning costs nothing.
 *
 * **An attendee list that may be empty.** A meeting nobody attends is allowed and
 * costs nothing, which is what lets the schedule be entered here and attendance
 * be ticked afterwards in the matrix.
 *
 * There is no "this occurrence / the whole series": editing always acts on the
 * series, because there are no per-occurrence exceptions in the model (§3.4).
 */
export function MeetingDialog({ open, teamId, members, window, editing, onClose, onStale }: Props) {
  const create = useCreateMeeting(teamId, window.from, window.to)
  const update = useUpdateMeeting(teamId, window.from, window.to)

  const [memberIds, setMemberIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('range')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [weekday, setWeekday] = useState(0)
  const [intervalWeeks, setIntervalWeeks] = useState(2)
  const [half, setHalf] = useState<Half>('am')
  // Held as text, not as a number. `Number(e.target.value)` on an empty field is
  // 0, and feeding that back as the input's value fights whoever is mid-edit:
  // clearing 60 and typing 120 leaves 1200 on screen. The string is what the
  // person typed; `minutes` below is what the form means by it.
  const [duration, setDuration] = useState('60')
  const [error, setError] = useState<string | null>(null)
  const [farFutureAccepted, setFarFutureAccepted] = useState(false)

  // Re-seeded whenever the dialog opens on something new, so editing one meeting
  // never shows the previous one's rule.
  useEffect(() => {
    if (!open) return
    setError(null)
    setFarFutureAccepted(false)
    if (editing) {
      setMemberIds([...attendeesOf(editing)])
      setTitle(editing.title)
      setKind(editing.kind as ScheduleKind)
      setStartDate(editing.start_date)
      setEndDate(editing.end_date ?? '')
      setWeekday(editing.weekday ?? weekdayIndex(editing.start_date))
      setIntervalWeeks(editing.interval_weeks ?? 2)
      setHalf((editing.half as Half) ?? 'am')
      setDuration(String(editing.duration_minutes))
      return
    }
    setMemberIds([])
    setTitle('')
    setKind('range')
    setStartDate('')
    setEndDate('')
    setWeekday(0)
    setIntervalWeeks(2)
    setHalf('am')
    setDuration('60')
  }, [open, editing])

  // A sanity check, never a horizon: a date past ten years is almost always a
  // typo'd year. So it asks, and then allows (§7.4).
  const farFuture = isFarFuture(startDate) || isFarFuture(endDate)

  // An empty field reads as 0, which fails the range check below and says so —
  // rather than saving a meeting of no length.
  const minutes = Number(duration)

  const chips = useMemo(
    () =>
      kind === 'interval'
        ? previewOccurrences(startDate, weekday, intervalWeeks, 5, endDate || null)
        : [],
    [kind, startDate, weekday, intervalWeeks, endDate],
  )

  const summary = describeMeetingDraft({
    kind,
    startDate,
    endDate,
    weekday,
    intervalWeeks,
    half,
    duration: minutes,
    attendeeCount: memberIds.length,
  })

  const toggleMember = (id: string) =>
    setMemberIds((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    )

  const allSelected = members.length > 0 && memberIds.length === members.length

  const body = (): MeetingCreate => ({
    title: title.trim(),
    kind,
    start_date: startDate,
    end_date: endDate || null,
    weekday: kind === 'range' ? null : weekday,
    interval_weeks: kind === 'interval' ? intervalWeeks : null,
    half,
    duration_minutes: minutes,
    member_ids: memberIds,
  })

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('A meeting needs a name.')
      return
    }
    if (!startDate) {
      setError(kind === 'range' ? 'A date is required.' : 'A first occurrence date is required.')
      return
    }
    if (endDate && endDate < startDate) {
      setError('The end date cannot fall before the start.')
      return
    }
    if (!Number.isInteger(minutes) || minutes < MIN_DURATION || minutes > MAX_DURATION || minutes % 5 !== 0) {
      setError(`Duration runs from ${MIN_DURATION} to ${MAX_DURATION} minutes, in steps of 5.`)
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
          meetingId: editing.system_id,
          etag: editing.etag ?? '',
          body: body(),
        })
      } else {
        await create.mutateAsync(body())
      }
      onClose()
    } catch (err) {
      const theirs = staleMeeting(err)
      if (theirs && editing) {
        // Nothing was written. Hand both versions up and get out of the way —
        // never a spinner, never a silent refetch (§4.2).
        onStale?.({ ...editing, ...body(), summary }, theirs)
        onClose()
        return
      }
      const code = meetingErrorCode(err)
      if (code === 'STALE') {
        setError('This meeting changed while you had it open. Close and reopen it to see the current values.')
      } else if (code === 'MEETING_LIMIT_REACHED' || code === 'INVALID_SCHEDULE') {
        setError(errorDetail(err)?.message ?? 'That meeting cannot be saved.')
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
            {editing ? 'Edit meeting' : 'Add meeting'}
          </Dialog.Title>

          {/* `noValidate`: the duration input carries min/max/step so the spinner
              steps in fives, but the browser's own bubble would pre-empt this
              form's messages and say less — one voice for every refusal. */}
          <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col sm:flex-row gap-5">
            <fieldset className="sm:w-[186px] shrink-0">
              <legend className="text-xs font-medium text-gray-500 dark:text-gray-400 flex w-full items-center gap-2">
                Attendees
                {members.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMemberIds(allSelected ? [] : members.map((m) => m.system_id))}
                    className="ml-auto text-[11px] text-blue-600 hover:underline"
                  >
                    {allSelected ? 'none' : `all ${members.length}`}
                  </button>
                )}
              </legend>
              {/* "Everyone is in the stand-up" is one click here and one click per
                  cell in the matrix; both write the same attendee set (§7.5). */}
              <div className="mt-2 rounded-lg bg-band shadow-soft-inset p-2 max-h-56 overflow-y-auto space-y-1">
                {members.map((member) => (
                  <label
                    key={member.system_id}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={memberIds.includes(member.system_id)}
                      onChange={() => toggleMember(member.system_id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="truncate">{member.name}</span>
                  </label>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-gray-400">Nobody on this team yet.</p>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                A meeting with nobody in it is allowed — it simply costs nothing.
              </p>
            </fieldset>

            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Name
                </label>
                <input
                  id="meeting-title"
                  name="title"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sprint planning"
                  className={inputClass}
                />
              </div>

              <KindTabs label="Meeting kind" value={kind} onChange={setKind} hints={KIND_HINTS} />

              {kind === 'range' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="On" htmlFor="meeting-from">
                    <DateInput id="meeting-from" value={startDate} onChange={setStartDate} className={inputClass} />
                  </Field>
                  <Field label="Until" htmlFor="meeting-to" hint="inclusive, empty = one day">
                    <DateInput id="meeting-to" value={endDate} onChange={setEndDate} className={inputClass} />
                  </Field>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {kind === 'interval' && (
                      <Field label="Every" htmlFor="meeting-interval" hint="weeks">
                        <input
                          id="meeting-interval"
                          type="number"
                          min={2}
                          max={52}
                          value={intervalWeeks}
                          onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                          className={inputClass}
                        />
                      </Field>
                    )}
                    <Field label="Weekday" htmlFor="meeting-weekday">
                      <select
                        id="meeting-weekday"
                        value={weekday}
                        onChange={(e) => setWeekday(Number(e.target.value))}
                        className={inputClass}
                      >
                        {WEEKDAYS.map((day, index) => (
                          <option key={day} value={index}>{WEEKDAY_LABELS[day]}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={kind === 'interval' ? 'First occurrence' : 'Runs from'}
                      htmlFor="meeting-anchor"
                      hint={kind === 'interval' ? 'the anchor — it picks the weeks' : undefined}
                    >
                      <DateInput id="meeting-anchor" value={startDate} onChange={setStartDate} className={inputClass} />
                    </Field>
                    <Field label="Until" htmlFor="meeting-until" hint="empty = open-ended">
                      <DateInput id="meeting-until" value={endDate} onChange={setEndDate} className={inputClass} />
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

              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts in" htmlFor="meeting-half">
                  <select
                    id="meeting-half"
                    value={half}
                    onChange={(e) => setHalf(e.target.value as Half)}
                    className={inputClass}
                  >
                    <option value="am">morning</option>
                    <option value="pm">afternoon</option>
                  </select>
                </Field>
                <Field label="Duration" htmlFor="meeting-duration" hint="minutes">
                  <div className="flex gap-2">
                    <input
                      id="meeting-duration"
                      type="number"
                      min={MIN_DURATION}
                      max={MAX_DURATION}
                      step={5}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className={inputClass}
                    />
                    <select
                      aria-label="Common durations"
                      value={DURATIONS.includes(minutes) ? duration : ''}
                      onChange={(e) => setDuration(e.target.value)}
                      className={`${inputClass} w-24`}
                    >
                      <option value="">…</option>
                      {DURATIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>
                      ))}
                    </select>
                  </div>
                </Field>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="meeting-summary">
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

/** "120 min" reads long in a column head; "2 h" does not. Minutes stay exact. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'no duration'
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${Math.floor(hours)} h ${rest} min`
}

interface MeetingDraftSummary {
  readonly kind: ScheduleKind
  readonly startDate: string
  readonly endDate: string
  readonly weekday: number
  readonly intervalWeeks: number
  readonly half: Half
  readonly duration: number
  readonly attendeeCount: number
}

/**
 * The rule in plain language, before it is saved.
 *
 * Says what it *costs* as well as what it is — "6 people" against a 480-minute
 * workshop is the sentence that catches a duration typed in hours, which the
 * fields alone do not.
 */
export function describeMeetingDraft(draft: MeetingDraftSummary): string {
  const who =
    draft.attendeeCount === 0
      ? 'nobody yet'
      : draft.attendeeCount === 1
        ? '1 person'
        : `${draft.attendeeCount} people`
  const length = `${formatDuration(draft.duration)} ${draft.half}`
  if (!draft.startDate) return 'pick a date to see what this costs'

  if (draft.kind === 'range') {
    const last = draft.endDate || draft.startDate
    const span =
      last === draft.startDate ? draft.startDate : `${draft.startDate} – ${last}, each day`
    return `${span}, ${length}, ${who}`
  }

  const dayLabel = WEEKDAY_LABELS[WEEKDAYS[draft.weekday]]
  const every =
    draft.kind === 'interval'
      ? `every ${draft.intervalWeeks} weeks on ${dayLabel}`
      : `every ${dayLabel}`
  const until = draft.endDate ? `until ${draft.endDate}` : 'ongoing'
  return `${every}, ${length}, from ${draft.startDate} ${until}, ${who}`
}
