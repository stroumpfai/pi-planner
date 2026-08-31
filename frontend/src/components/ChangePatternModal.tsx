import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { HalfDayToggles } from '@/components/HalfDayToggles'
import { useAddPatternVersion } from '@/hooks/useTeamMembers'
import { memberErrorCode } from '@/services/teamMembers'
import { errorDetail } from '@/services/api'
import type { TeamMember } from '@/types'
import { fmtDate } from '@/utils/dates'
import {
  FOCUS_STEPS,
  FULL_WEEK,
  halvesOf,
  todayIso,
  type HalfDayKey,
  type HalfDayMap,
} from '@/utils/workingDays'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly member: TeamMember
  readonly defaultDate: string
  readonly onClose: () => void
  readonly onSaved: (effectiveFrom: string) => void
}

/**
 * "Change from…" — a member's contract, from a date (teams.md §3.3).
 *
 * Pre-filled with the pattern currently in force, because a contract change is
 * almost always a small edit to what is already there: 100% to 80% is one day
 * off, not a form to fill in again.
 *
 * Saving onto a date that already has a version **replaces** that version rather
 * than adding a second one — one date, one version, so a gap or an overlap cannot
 * be expressed.
 */
export function ChangePatternModal({ open, teamId, member, defaultDate, onClose, onSaved }: Props) {
  const add = useAddPatternVersion(teamId)
  const current = member.effective_version

  const [effectiveFrom, setEffectiveFrom] = useState(defaultDate)
  const [halves, setHalves] = useState<HalfDayMap>(current ? halvesOf(current) : FULL_WEEK)
  const [hoursPerDay, setHoursPerDay] = useState(String(current?.hours_per_day ?? 8))
  const [focus, setFocus] = useState(String(current?.focus ?? 1))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const today = todayIso()
  const isBackdated = effectiveFrom !== '' && effectiveFrom < today
  const replaces = (member.version_dates ?? []).includes(effectiveFrom)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (effectiveFrom === '') {
      setError('A change needs the date it starts from.')
      return
    }
    try {
      await add.mutateAsync({
        memberId: member.system_id,
        body: {
          ...halves,
          effective_from: effectiveFrom,
          hours_per_day: Number(hoursPerDay),
          focus: Number(focus),
          note: note.trim() || null,
        },
      })
      onSaved(effectiveFrom)
    } catch (err) {
      const code = memberErrorCode(err)
      setError(
        code === 'PATTERN_VERSION_LIMIT_REACHED'
          ? (errorDetail(err)?.message ?? 'This member already holds the maximum number of versions.')
          : 'Could not save the change — please try again.',
      )
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Change {member.name}&rsquo;s working days
          </Dialog.Title>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {current
              ? `Starting from the pattern in force since ${fmtDate(current.effective_from)}. Nothing before the new date moves.`
              : 'Nothing before the new date moves.'}
          </p>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="change-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Change from <span className="text-red-500">*</span>
              </label>
              <DateInput
                id="change-from"
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {replaces && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  A version already starts on this date — saving replaces it.
                </p>
              )}
            </div>

            {isBackdated && (
              <p role="alert" className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                This date is in the past. Sprints in closed PIs are not recomputed, so their
                figures keep the pattern they were planned with.
              </p>
            )}

            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Working days</span>
              <HalfDayToggles
                halves={halves}
                ownerLabel={member.name}
                showDayLabels
                onToggle={(key: HalfDayKey, next) => setHalves({ ...halves, [key]: next })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="change-hours" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Hours per day
                </label>
                <input
                  id="change-hours"
                  name="hours_per_day"
                  type="number"
                  step="any"
                  value={hoursPerDay}
                  onChange={(e) => setHoursPerDay(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="change-focus" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Focus</label>
                <select
                  id="change-focus"
                  name="focus"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  {FOCUS_STEPS.map((step) => (
                    <option key={step} value={step}>{step.toFixed(2)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="change-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Note</label>
              <input
                id="change-note"
                name="note"
                value={note}
                maxLength={100}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. 80% from September"
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={add.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {add.isPending ? 'Saving…' : 'Save change'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
