import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useApplyPush, usePushPreviews, usePushTeam } from '@/hooks/useTeamPush'
import { pushErrorCode, pushErrorMessage } from '@/services/teamPush'
import { fmtDate, fmtDateTime } from '@/utils/dates'
import type { ProjectPushResult, PushPreview, PushSprintRow, TeamAssignment } from '@/types'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly teamName: string
  readonly assignments: readonly TeamAssignment[]
  readonly onClose: () => void
}

/**
 * Update project(s) — review, then apply (teams.md §6.7; design 1d).
 *
 * Three things this dialog exists to get right:
 *
 * **Proposed is the integer that will be written.** Rounding happens here, in
 * view, and not silently on apply — the PD and hours behind it sit in the same
 * row so a misplaced decimal in the conversion factor is visible before anything
 * is written. That review *is* the guard rail; the schema deliberately has no
 * opinion about what a good factor looks like (§6.4).
 *
 * **The result is per project and partial success is normal.** A project someone
 * else is editing fails on its own row while the others apply, and offers
 * *Retry this one*. Failing all three because one is locked would reintroduce
 * the coupling this whole design removes.
 *
 * **A manual project is not offered.** Nothing is meant to flow into one, so it
 * appears greyed with its reason rather than as an unticked box that would look
 * like a choice someone made.
 */
export function PushProjectsModal({ open, teamId, teamName, assignments, onClose }: Props) {
  const pushable = useMemo(
    () => assignments.filter((row) => row.available_source !== 'manual'),
    [assignments],
  )
  const manual = useMemo(
    () => assignments.filter((row) => row.available_source === 'manual'),
    [assignments],
  )

  const [excluded, setExcluded] = useState<readonly string[]>([])
  const [results, setResults] = useState<ProjectPushResult[] | null>(null)

  const previews = usePushPreviews(
    pushable.map((row) => row.project_id),
    open,
  )
  const pushTeam = usePushTeam(teamId)
  const applyOne = useApplyPush()

  const selected = pushable.filter((row) => !excluded.includes(row.project_id))
  const loading = previews.some((query) => query.isLoading)

  const close = () => {
    setExcluded([])
    setResults(null)
    onClose()
  }

  const toggle = (projectId: string) =>
    setExcluded((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    )

  /**
   * Apply the ticked projects.
   *
   * With everything ticked this is the team endpoint — one call, one result list,
   * and the per-project rows come back already shaped. With a narrower selection
   * it loops the single-project endpoint, which is exactly what the team endpoint
   * does server-side; a rejection there is turned into a result row rather than
   * thrown, because a locked project is an outcome to render, not a failure of
   * the dialog.
   */
  const apply = async () => {
    if (selected.length === pushable.length && pushable.length > 0) {
      const response = await pushTeam.mutateAsync()
      setResults(response.results.filter((row) => row.status !== 'manual'))
      return
    }
    const collected: ProjectPushResult[] = []
    for (const row of selected) {
      try {
        collected.push(await applyOne.mutateAsync(row.project_id))
      } catch (err) {
        collected.push(failedRow(row, err))
      }
    }
    setResults(collected)
  }

  const retry = async (row: ProjectPushResult) => {
    const replacement = await applyOne
      .mutateAsync(row.project_id)
      .catch((err: unknown) => failedRow(row, err))
    setResults((current) =>
      (current ?? []).map((entry) =>
        entry.project_id === row.project_id ? replacement : entry,
      ),
    )
  }

  const applying = pushTeam.isPending || applyOne.isPending

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-canvas rounded-xl shadow-soft w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        >
          <div className="px-5 py-4 border-b border-white/60 dark:border-white/10">
            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Update projects from team {teamName}
            </Dialog.Title>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {results
                ? 'Step 2 of 2 — result, per project. Projects are updated one at a time.'
                : 'Step 1 of 2 — review. Nothing is written until you apply.'}
            </p>
          </div>

          {results ? (
            <ResultList results={results} onRetry={retry} retrying={applyOne.isPending} />
          ) : (
            <div className="px-5 py-4 space-y-5">
              {pushable.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No project served by this team derives its Available from the team yet. Switch an
                  assignment to a conversion factor to push into it.
                </p>
              ) : (
                <>
                  <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
                    <legend className="sr-only">Projects to update</legend>
                    {pushable.map((row) => (
                      <label
                        key={row.project_id}
                        className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={!excluded.includes(row.project_id)}
                          onChange={() => toggle(row.project_id)}
                        />
                        {row.project_name} ({row.share_pct}%)
                      </label>
                    ))}
                  </fieldset>

                  {loading ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">Computing…</p>
                  ) : (
                    previews.map((query, index) => (
                      <ProjectPreview
                        key={pushable[index].project_id}
                        preview={query.data}
                        error={query.error}
                        fallbackName={pushable[index].project_name}
                        included={!excluded.includes(pushable[index].project_id)}
                      />
                    ))
                  )}

                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Proposed is the whole number that will be written — rounding happens here, in
                    view, not silently on apply.
                  </p>
                </>
              )}

              {manual.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {manual.map((row) => row.project_name).join(', ')} type their Available by hand
                  and are not updated.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 px-5 py-4 border-t border-white/60 dark:border-white/10">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
            >
              {results ? 'Close' : 'Cancel'}
            </button>
            {/* "Apply to 0 projects" is not a button anyone should read: with
                nothing pushable there is no action, only the explanation above. */}
            {!results && pushable.length > 0 && (
              <button
                type="button"
                onClick={apply}
                disabled={applying || loading || selected.length === 0}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {applying
                  ? 'Applying…'
                  : `Apply to ${selected.length} ${selected.length === 1 ? 'project' : 'projects'}`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A rejected apply, rendered as the result row it is rather than thrown away. */
function failedRow(
  row: { project_id: string; project_name: string },
  err: unknown,
): ProjectPushResult {
  const code = pushErrorCode(err)
  return {
    project_id: row.project_id,
    project_name: row.project_name,
    status: code === 'AVAILABLE_SOURCE_IS_MANUAL' ? 'manual' : 'error',
    updated_sprints: 0,
    total_delta: 0,
    message: pushErrorMessage(err) ?? 'Could not update this project.',
    locked_by: lockHolder(err),
    locked_until: null,
  }
}

function lockHolder(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: { locked_by?: string } } } } | undefined)
    ?.response?.data?.detail
  return detail?.locked_by ?? null
}

// The design's review table (1d): sprint · Current · Proposed · Δ · behind it.
const REVIEW_COLUMNS = 'grid-cols-[1.1fr_.8fr_.9fr_.6fr_1.3fr]'

interface PreviewProps {
  readonly preview: PushPreview | undefined
  readonly error: unknown
  readonly fallbackName: string
  readonly included: boolean
}

function ProjectPreview({ preview, error, fallbackName, included }: PreviewProps) {
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        {fallbackName}: {pushErrorMessage(error) ?? 'could not be previewed.'}
      </p>
    )
  }
  if (!preview) return null

  return (
    <section
      aria-label={`${preview.project_name} preview`}
      className={included ? '' : 'opacity-40'}
    >
      <div
        className={`grid ${REVIEW_COLUMNS} gap-2 px-3 py-1.5 bg-band/40 text-[10.5px] uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400 rounded-t-lg`}
      >
        <span>{preview.project_name} · PI.sprint</span>
        <span>Current</span>
        <span>Proposed</span>
        <span>Δ</span>
        <span>behind it</span>
      </div>
      <ul className="divide-y divide-white/60 dark:divide-white/10">
        {preview.sprints.map((row) => (
          <ReviewRow key={row.sprint_id} row={row} unit={preview.effort_unit} />
        ))}
      </ul>
      {preview.sprints.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
          No open sprint to update — a closed PI keeps the numbers it was closed with.
        </p>
      )}
    </section>
  )
}

function ReviewRow({ row, unit }: { readonly row: PushSprintRow; readonly unit: string }) {
  const undated = row.proposed_available === null
  return (
    <li className={`grid ${REVIEW_COLUMNS} gap-2 px-3 py-1.5 text-xs items-baseline`}>
      <span className="text-gray-700 dark:text-gray-300 truncate" title={row.label}>
        {row.label}
        {row.start_date && (
          <span className="block text-[10px] text-gray-400 dark:text-gray-500">
            {fmtDate(row.start_date)} – {fmtDate(row.end_date)}
          </span>
        )}
      </span>
      <span className="text-gray-500 dark:text-gray-400">
        {row.current_available} {unit}
      </span>
      <span className="font-semibold text-gray-900 dark:text-gray-100">
        {undated ? '—' : `${row.proposed_available} ${unit}`}
      </span>
      <span className={deltaClass(row.delta)}>{formatDelta(row.delta)}</span>
      <span className="text-gray-400 dark:text-gray-500">
        {/* Undated is unknown, not empty: a sprint nobody has dated cannot take a
            budget from a calendar it is not on. */}
        {undated
          ? 'no dates yet'
          : `${(row.share_adjusted_person_days ?? 0).toFixed(1)} PD · ${(row.in_project_units ?? 0).toFixed(1)} ${unit}`}
      </span>
    </li>
  )
}

function formatDelta(delta: number | null): string {
  if (delta === null) return '—'
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta}` : String(delta)
}

function deltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return 'text-gray-400 dark:text-gray-500'
  return delta > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-amber-600 dark:text-amber-400'
}

interface ResultListProps {
  readonly results: readonly ProjectPushResult[]
  readonly onRetry: (row: ProjectPushResult) => void
  readonly retrying: boolean
}

function ResultList({ results, onRetry, retrying }: ResultListProps) {
  return (
    <ul className="px-5 py-4 space-y-2">
      {results.map((row) => (
        <li key={row.project_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="w-40 shrink-0 text-gray-700 dark:text-gray-300 truncate">
            {row.project_name}
          </span>
          {row.status === 'updated' && (
            <span className="text-gray-700 dark:text-gray-300">
              ✓ {row.updated_sprints} {row.updated_sprints === 1 ? 'sprint' : 'sprints'} updated
            </span>
          )}
          {row.status === 'no_change' && (
            <span className="text-gray-400 dark:text-gray-500">✓ no change</span>
          )}
          {(row.status === 'locked' || row.status === 'error' || row.status === 'manual') && (
            <>
              <span className="text-red-600 dark:text-red-400">
                ✗{' '}
                {row.status === 'locked'
                  ? `locked by ${row.locked_by} until ${fmtDateTime(row.locked_until, 'the lock expires')}`
                  : row.message}
              </span>
              {row.status === 'locked' && (
                <button
                  type="button"
                  onClick={() => onRetry(row)}
                  disabled={retrying}
                  className="px-2 py-0.5 text-xs rounded-lg border border-red-500 text-red-600 dark:text-red-400 disabled:opacity-50"
                >
                  Retry this one
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
