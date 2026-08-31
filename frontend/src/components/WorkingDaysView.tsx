import { useState } from 'react'
import { ChangePatternModal } from '@/components/ChangePatternModal'
import { DateInput } from '@/components/DateInput'
import { HalfDayToggles } from '@/components/HalfDayToggles'
import { useTeamMembers, useUpdatePatternVersion } from '@/hooks/useTeamMembers'
import { MEMBER_CHANGED_MESSAGE, memberErrorCode } from '@/services/teamMembers'
import { useAuthStore } from '@/stores/authStore'
import type { TeamMember } from '@/types'
import { fmtDate } from '@/utils/dates'
import {
  FOCUS_STEPS,
  HALF_DAY_KEYS,
  HALVES,
  WEEKDAYS,
  WEEKDAY_LABELS,
  halvesOf,
  isWeekend,
  todayIso,
  type HalfDayKey,
  type Weekday,
} from '@/utils/workingDays'

interface Props {
  readonly teamId: string
  /** Opened from a member's chip in the Members view, so that row leads. */
  readonly focusMemberId?: string | null
}

/**
 * Who works when, on a chosen date (teams.md §7.3).
 *
 * **One date governs the whole view.** The grid is not "the current pattern" — it
 * is the pattern in force on the date above it, which is what lets the view
 * answer the question people actually have ("what does September look like?")
 * without leaving the screen. Every toggle, every hours field and every focus
 * value below therefore edits the version that date resolves to.
 *
 * Which means an edit here can be an edit to a **past** version, and the banner
 * says so: back-dating is allowed, but sprints in closed PIs are not recomputed
 * (§11). Dating a *new* version is the other action, and it is a button rather
 * than a side effect of typing.
 */
export function WorkingDaysView({ teamId, focusMemberId = null }: Props) {
  const [asOf, setAsOf] = useState(todayIso())
  const { data: members, isLoading } = useTeamMembers(teamId, asOf)
  const canEdit = useAuthStore((s) => s.canEdit())
  const updateVersion = useUpdatePatternVersion(teamId)
  const [changing, setChanging] = useState<TeamMember | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = order(members ?? [], focusMemberId)
  const today = todayIso()

  const write = async (member: TeamMember, body: Record<string, unknown>) => {
    const version = member.effective_version
    if (!version) return
    setError(null)
    try {
      await updateVersion.mutateAsync({
        memberId: member.system_id,
        versionId: version.system_id,
        etag: version.etag ?? '',
        body,
      })
    } catch (err) {
      setError(
        memberErrorCode(err) === 'STALE'
          ? MEMBER_CHANGED_MESSAGE
          : 'Could not save that change — please try again.',
      )
    }
  }

  /**
   * Whether a bulk toggle should switch things on or off.
   *
   * On unless everything in the group is already on — the same rule for a column
   * and for a row, so a half-filled week fills rather than empties. Emptying a
   * week that is only partly worked would be a surprising amount of destruction
   * for one click.
   */
  const allOn = (keys: readonly HalfDayKey[], members: readonly TeamMember[]) =>
    members.length > 0 &&
    members.every((m) => m.effective_version && keys.every((key) => m.effective_version?.[key]))

  const toggleWeekday = (day: Weekday) => {
    const keys = HALVES.map((half) => `${day}_${half}` as HalfDayKey)
    const next = !allOn(keys, rows)
    // One write per member, because each row is its own version with its own
    // precondition — there is no bulk endpoint and a shared one would need a
    // shared ETag, which these rows do not have (§4.2).
    rows.forEach((member) => write(member, Object.fromEntries(keys.map((key) => [key, next]))))
  }

  const toggleMember = (member: TeamMember) => {
    const next = !allOn(HALF_DAY_KEYS, [member])
    write(member, Object.fromEntries(HALF_DAY_KEYS.map((key) => [key, next])))
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="as-of" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
            Pattern in effect on
          </label>
          <DateInput
            id="as-of"
            value={asOf}
            onChange={(iso) => setAsOf(iso || today)}
            className="mt-1 w-36 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setAsOf(today)}
          className="px-3 py-2 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 hover:shadow-soft-hover"
        >
          Today
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 flex-1 min-w-[16rem]">
          Everything below is the contract in force on this date. Editing it changes that
          version; use <span className="font-medium">Change from…</span> to start a new one.
        </p>
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading patterns…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">Nobody on this team yet — add a member to give them a pattern.</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/60 shadow-soft rounded-xl bg-canvas">
          {/* The column headers are controls, not captions: one click sets a
              weekday for the whole team, which is how a team-wide change like
              "nobody works Fridays" is entered (§7.3). */}
          <li className="px-4 py-2 flex items-center gap-4 bg-band/40 rounded-t-xl">
            <span className="w-44 shrink-0 text-xs text-gray-400 dark:text-gray-500">
              Member
            </span>
            <div className="flex items-end gap-2">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleWeekday(day)}
                  aria-label={`Toggle ${WEEKDAY_LABELS[day]} for everyone`}
                  title={`Toggle ${WEEKDAY_LABELS[day]} for everyone`}
                  className={`w-[42px] text-[10px] uppercase tracking-wide rounded-md py-0.5 disabled:cursor-not-allowed ${
                    isWeekend(day)
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-gray-400 dark:text-gray-500'
                  } ${canEdit ? 'hover:text-blue-600 hover:bg-canvas' : ''}`}
                >
                  {WEEKDAY_LABELS[day]}
                </button>
              ))}
            </div>
          </li>
          {rows.map((member) => {
            const version = member.effective_version
            const backdated = version !== null && version !== undefined && version.effective_from < today
            return (
              <li key={member.system_id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="w-44 shrink-0">
                    {canEdit && version ? (
                      <button
                        type="button"
                        onClick={() => toggleMember(member)}
                        aria-label={`Toggle every half-day for ${member.name}`}
                        title="Toggle the whole week"
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate hover:text-blue-600 text-left"
                      >
                        {member.name}
                      </button>
                    ) : (
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.name}</p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {version ? `version from ${fmtDate(version.effective_from)}` : 'no version'}
                    </p>
                  </div>

                  {version && (
                    <>
                      <HalfDayToggles
                        halves={halvesOf(version)}
                        ownerLabel={member.name}
                        disabled={!canEdit}
                        onToggle={(key: HalfDayKey, next) => write(member, { [key]: next })}
                      />

                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 dark:text-gray-400" htmlFor={`hours-${member.system_id}`}>
                          h/day
                        </label>
                        <input
                          id={`hours-${member.system_id}`}
                          type="number"
                          step="any"
                          disabled={!canEdit}
                          defaultValue={version.hours_per_day}
                          key={`${version.system_id}-${version.hours_per_day}`}
                          onBlur={(e) => {
                            const value = Number(e.target.value)
                            if (value !== version.hours_per_day) write(member, { hours_per_day: value })
                          }}
                          aria-label={`${member.name} hours per day`}
                          className="w-16 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm text-xs disabled:opacity-60"
                        />
                        <label className="text-xs text-gray-500 dark:text-gray-400" htmlFor={`focus-${member.system_id}`}>
                          focus
                        </label>
                        <select
                          id={`focus-${member.system_id}`}
                          disabled={!canEdit}
                          value={version.focus}
                          aria-label={`${member.name} focus`}
                          onChange={(e) => write(member, { focus: Number(e.target.value) })}
                          className="w-20 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm text-xs disabled:opacity-60"
                        >
                          {FOCUS_STEPS.map((step) => (
                            <option key={step} value={step}>{step.toFixed(2)}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-3 ml-auto">
                    <VersionTimeline
                      dates={member.version_dates ?? []}
                      current={version?.effective_from ?? null}
                      onPick={setAsOf}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setChanging(member)}
                        className="px-2 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover whitespace-nowrap"
                      >
                        Change from…
                      </button>
                    )}
                  </div>
                </div>

                {backdated && canEdit && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    This version took effect on {fmtDate(version.effective_from)}. Editing it changes
                    the past — sprints in closed PIs are not recomputed.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {changing && (
        <ChangePatternModal
          open
          teamId={teamId}
          member={changing}
          defaultDate={asOf}
          onClose={() => setChanging(null)}
          onSaved={(effectiveFrom) => {
            setChanging(null)
            // Move the view to the date just written, so the change is visible
            // rather than merely saved.
            setAsOf(effectiveFrom)
          }}
        />
      )}
    </div>
  )
}

interface TimelineProps {
  readonly dates: readonly string[]
  readonly current: string | null
  readonly onPick: (date: string) => void
}

/**
 * A marker per `effective_from` — this member's contract history, in a row.
 *
 * Each marker sets the view's date, which makes the timeline a control rather
 * than a decoration: clicking the September marker shows September's pattern.
 */
function VersionTimeline({ dates, current, onPick }: TimelineProps) {
  if (dates.length <= 1) {
    return <span className="text-xs text-gray-300 dark:text-gray-600">one version</span>
  }
  return (
    <div className="flex items-center gap-1" aria-label="Version timeline">
      {dates.map((date) => (
        <button
          key={date}
          type="button"
          onClick={() => onPick(date)}
          title={`Show the pattern from ${fmtDate(date)}`}
          aria-label={`Pattern from ${fmtDate(date)}`}
          className={`w-2.5 h-2.5 rounded-full ${
            date === current ? 'bg-blue-500 shadow-soft-sm' : 'bg-band shadow-soft-inset hover:bg-blue-200'
          }`}
        />
      ))}
    </div>
  )
}

/** The member opened from Members leads; everyone else keeps the team's order. */
function order(members: readonly TeamMember[], focusMemberId: string | null): TeamMember[] {
  if (!focusMemberId) return [...members]
  const focused = members.filter((m) => m.system_id === focusMemberId)
  return [...focused, ...members.filter((m) => m.system_id !== focusMemberId)]
}
