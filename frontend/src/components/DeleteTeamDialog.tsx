import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { useDeleteTeam } from '@/hooks/useTeams'
import { blockingProjects, teamErrorCode, TEAM_CHANGED_MESSAGE, type BlockingProject } from '@/services/teams'
import type { Team } from '@/types'

interface Props {
  readonly team: Team
  readonly onClose: () => void
}

/**
 * Deleting a team is blocked while it serves projects, so nobody loses a capacity
 * model by accident (teams.md §10). The block is only actionable if the user can
 * see *which* projects to unassign, so the 409's list is rendered by name.
 */
export function DeleteTeamDialog({ team, onClose }: Props) {
  const deleteTeam = useDeleteTeam()
  const [blocked, setBlocked] = useState<BlockingProject[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const handleConfirm = async () => {
    setMessage(null)
    setBlocked([])
    try {
      await deleteTeam.mutateAsync(team.system_id)
      onClose()
    } catch (err) {
      const code = teamErrorCode(err)
      if (code === 'TEAM_HAS_PROJECTS') {
        setBlocked(blockingProjects(err))
        setMessage('Unassign these projects before deleting this team:')
      } else if (code === 'STALE') {
        setMessage(TEAM_CHANGED_MESSAGE)
      } else {
        setMessage('Could not delete the team — please try again.')
      }
    }
  }

  return (
    <ConfirmDialog
      open
      title="Delete team"
      description={`"${team.name}" and everything in it will be permanently deleted.`}
      confirmLabel="Delete"
      destructive
      confirmDisabled={blocked.length > 0}
      error={
        message && (
          <>
            <p>{message}</p>
            {blocked.length > 0 && (
              <ul className="mt-2 list-disc list-inside">
                {blocked.map((project) => (
                  <li key={project.system_id}>{project.name}</li>
                ))}
              </ul>
            )}
          </>
        )
      }
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  )
}
