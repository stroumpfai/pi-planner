import { useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { HalfDayToggles } from '@/components/HalfDayToggles'
import { TextCombobox } from '@/components/TextCombobox'
import { useCreateMember } from '@/hooks/useTeamMembers'
import { memberErrorCode } from '@/services/teamMembers'
import { errorDetail } from '@/services/api'
import type { TeamMember } from '@/types'
import {
  FOCUS_STEPS,
  FULL_WEEK,
  PATTERN_PRESETS,
  halvesOf,
  todayIso,
  type HalfDayKey,
  type HalfDayMap,
} from '@/utils/workingDays'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly members: readonly TeamMember[]
  readonly onClose: () => void
}

/**
 * Add a member, and their first working pattern, in one form (teams.md §3.3).
 *
 * The two halves of this dialog cannot be separated: a member with no pattern
 * version has no contracted half-days, which computes as zero capacity and reads
 * as a team that does no work rather than as data nobody entered. So there is no
 * "add them now, set their days later" path — this form carries both, and the
 * backend writes them in one transaction.
 *
 * `effective_from` defaults to the day they join, because that is the date their
 * contract starts being true.
 */
export function AddMemberModal({ open, teamId, members, onClose }: Props) {
  const create = useCreateMember(teamId)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [activeFrom, setActiveFrom] = useState('')
  const [activeTo, setActiveTo] = useState('')
  const [halves, setHalves] = useState<HalfDayMap>(FULL_WEEK)
  const [hoursPerDay, setHoursPerDay] = useState('8')
  const [focus, setFocus] = useState('1')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [note, setNote] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // The form is taller than the dialog, so a rejection has to bring its field
  // back into view — an error message above the fold is an error nobody reads.
  const nameRef = useRef<HTMLInputElement | null>(null)

  // Suggestions come from the team's own values, and nothing else — there is no
  // vocabulary to administer behind them (§3.2).
  const roles = useMemo(() => suggestionsFrom(members, 'role'), [members])
  const organisations = useMemo(() => suggestionsFrom(members, 'organisation'), [members])

  const reset = () => {
    setName(''); setRole(''); setOrganisation('')
    setActiveFrom(''); setActiveTo(''); setEffectiveFrom('')
    setHalves(FULL_WEEK); setHoursPerDay('8'); setFocus('1'); setNote('')
    setNameError(null); setFormError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const copyFrom = (memberId: string) => {
    const source = members.find((m) => m.system_id === memberId)
    if (!source?.effective_version) return
    setHalves(halvesOf(source.effective_version))
    setHoursPerDay(String(source.effective_version.hours_per_day))
    setFocus(String(source.effective_version.focus))
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setNameError(null)

    if (name.trim() === '') {
      rejectName('Name is required')
      return
    }
    if (activeFrom !== '' && activeTo !== '' && activeTo < activeFrom) {
      setFormError('The last day on the team cannot fall before the first.')
      return
    }

    try {
      await create.mutateAsync({
        name: name.trim(),
        role: role.trim() || null,
        organisation: organisation.trim() || null,
        active_from: activeFrom || null,
        active_to: activeTo || null,
        pattern: {
          ...halves,
          hours_per_day: Number(hoursPerDay),
          focus: Number(focus),
          note: note.trim() || null,
          // Left null when nothing is said: the backend dates it to active_from,
          // or today — the same rule, in one place (§3.3).
          effective_from: effectiveFrom || null,
        },
      })
      close()
    } catch (err) {
      const code = memberErrorCode(err)
      if (code === 'MEMBER_NAME_TAKEN') {
        rejectName('This team already has a member with that name')
      } else if (code === 'MEMBER_LIMIT_REACHED') {
        setFormError(errorDetail(err)?.message ?? 'This team already holds the maximum number of members.')
      } else {
        setFormError('Could not add the member — please try again.')
      }
    }
  }

  const rejectName = (message: string) => {
    setNameError(message)
    nameRef.current?.focus()
  }

  const patternStart = effectiveFrom || activeFrom || todayIso()

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Add member
          </Dialog.Title>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="member-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="member-name"
                name="name"
                ref={nameRef}
                value={name}
                autoFocus
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
                <TextCombobox id="role" value={role} onChange={setRole} suggestions={roles} placeholder="e.g. Dev" />
              </div>
              <div>
                <label htmlFor="organisation" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Organisation
                </label>
                <TextCombobox
                  id="organisation"
                  value={organisation}
                  onChange={setOrganisation}
                  suggestions={organisations}
                  placeholder="e.g. BIT"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="active-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  On the team from
                </label>
                <DateInput
                  id="active-from"
                  value={activeFrom}
                  onChange={setActiveFrom}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="active-to" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Until
                </label>
                <DateInput
                  id="active-to"
                  value={activeTo}
                  onChange={setActiveTo}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <fieldset className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 pt-2">Working days</legend>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                The contract from {patternStart}. Changing it later dates a new version, so nothing
                already planned moves.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {PATTERN_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setHalves(preset.halves)}
                    className="px-2 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 hover:shadow-soft-hover"
                  >
                    {preset.label}
                  </button>
                ))}
                {members.length > 0 && (
                  <select
                    aria-label="Copy pattern from"
                    defaultValue=""
                    onChange={(e) => { copyFrom(e.target.value); e.currentTarget.value = '' }}
                    className="px-2 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 border-0 focus:ring-blue-500"
                  >
                    <option value="" disabled>Copy from…</option>
                    {members.map((m) => (
                      <option key={m.system_id} value={m.system_id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mt-3">
                <HalfDayToggles
                  halves={halves}
                  ownerLabel="New member"
                  showDayLabels
                  onToggle={(key: HalfDayKey, next) => setHalves({ ...halves, [key]: next })}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="hours-per-day" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Hours per day
                  </label>
                  <input
                    id="hours-per-day"
                    name="hours_per_day"
                    type="number"
                    step="any"
                    value={hoursPerDay}
                    onChange={(e) => setHoursPerDay(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="focus" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Focus</label>
                  <select
                    id="focus"
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

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="effective-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Pattern from
                  </label>
                  <DateInput
                    id="effective-from"
                    value={effectiveFrom}
                    onChange={setEffectiveFrom}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="pattern-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Note</label>
                  <input
                    id="pattern-note"
                    name="note"
                    value={note}
                    maxLength={100}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. 80% from July"
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>
              </div>
            </fieldset>

            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {create.isPending ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function suggestionsFrom(members: readonly TeamMember[], field: 'role' | 'organisation'): string[] {
  const seen = new Set<string>()
  for (const member of members) {
    const value = member[field]
    if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
