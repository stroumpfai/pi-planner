import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { TextCombobox } from '@/components/TextCombobox'
import { useUpdateMember } from '@/hooks/useTeamMembers'
import { MEMBER_CHANGED_MESSAGE, memberErrorCode } from '@/services/teamMembers'
import type { TeamMember } from '@/types'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly member: TeamMember
  readonly members: readonly TeamMember[]
  readonly onClose: () => void
}

/**
 * Edit who a member is and when they are on the team — and nothing else.
 *
 * Hours and focus are absent by design (teams.md §7.2): they are contract terms
 * on a dated version, so changing them means dating a new one in the Working days
 * view, not overwriting a field here. Putting them in this form would silently
 * restate every sprint already planned.
 *
 * `active_to` is the honest way to record a leaver: their absences, attendance
 * and pattern history survive, and half-days after that date stop counting.
 * Deleting them takes all of it (§10).
 */
export function EditMemberModal({ open, teamId, member, members, onClose }: Props) {
  const update = useUpdateMember(teamId)

  const [name, setName] = useState(member.name)
  const [role, setRole] = useState(member.role ?? '')
  const [organisation, setOrganisation] = useState(member.organisation ?? '')
  const [activeFrom, setActiveFrom] = useState(member.active_from ?? '')
  const [activeTo, setActiveTo] = useState(member.active_to ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const roles = useMemo(() => values(members, 'role'), [members])
  const organisations = useMemo(() => values(members, 'organisation'), [members])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setNameError(null)

    if (name.trim() === '') {
      setNameError('Name is required')
      return
    }
    if (activeFrom !== '' && activeTo !== '' && activeTo < activeFrom) {
      setFormError('The last day on the team cannot fall before the first.')
      return
    }

    try {
      await update.mutateAsync({
        memberId: member.system_id,
        // The tag belongs to the values this form was opened on, which is what
        // makes the precondition mean anything (§4.2).
        etag: member.etag ?? '',
        body: {
          name: name.trim(),
          role: role.trim() || null,
          organisation: organisation.trim() || null,
          active_from: activeFrom || null,
          active_to: activeTo || null,
        },
      })
      onClose()
    } catch (err) {
      const code = memberErrorCode(err)
      if (code === 'MEMBER_NAME_TAKEN') {
        setNameError('This team already has a member with that name')
      } else if (code === 'STALE') {
        setFormError(MEMBER_CHANGED_MESSAGE)
      } else {
        setFormError('Could not save the member — please try again.')
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Edit member
          </Dialog.Title>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="edit-member-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-member-name"
                name="name"
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
                <label htmlFor="edit-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
                <TextCombobox id="edit-role" value={role} onChange={setRole} suggestions={roles} />
              </div>
              <div>
                <label htmlFor="edit-organisation" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Organisation
                </label>
                <TextCombobox
                  id="edit-organisation"
                  value={organisation}
                  onChange={setOrganisation}
                  suggestions={organisations}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-active-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  On the team from
                </label>
                <DateInput
                  id="edit-active-from"
                  value={activeFrom}
                  onChange={setActiveFrom}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="edit-active-to" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Until
                </label>
                <DateInput
                  id="edit-active-to"
                  value={activeTo}
                  onChange={setActiveTo}
                  className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">
              Hours per day and focus are set in Working days — they change from a date, so
              editing them dates a new version rather than rewriting what is already planned.
            </p>

            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}

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
                disabled={update.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function values(members: readonly TeamMember[], field: 'role' | 'organisation'): string[] {
  const seen = new Set<string>()
  for (const member of members) {
    const value = member[field]
    if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
