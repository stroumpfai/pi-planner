interface Props {
  readonly teamId: string
}

/**
 * The team workspace.
 *
 * A placeholder until the team API lands: the shell routes here so the
 * project / team split exists in one place rather than being retrofitted, but
 * nothing navigates to it yet — there is no way to select a team.
 */
export const TeamPage: React.FC<Props> = ({ teamId }) => {
  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-gray-500 dark:text-gray-400" data-team-id={teamId}>
        This team has no views yet.
      </p>
    </div>
  )
}
