import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CapacityMembersSummary } from '@/components/CapacityMembersSummary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { MeetingColumnHead } from '@/components/MeetingColumnHead'
import { MeetingDialog, formatDuration } from '@/components/MeetingDialog'
import { useMeetings, useDeleteMeeting, useReorderMeetings, useUpdateMeeting } from '@/hooks/useMeetings'
import { useTeamMembers } from '@/hooks/useTeamMembers'
import { useTeamCapacity } from '@/hooks/useTeamProjects'
import { attendeesOf, meetingErrorCode, occurrencesOf, staleMeeting } from '@/services/meetings'
import { useAuthStore } from '@/stores/authStore'
import type { CapacitySprint, Meeting, TeamMember } from '@/types'
import { monthOf, windowOf } from '@/utils/absenceGrid'
import { splitByCapacity } from '@/utils/capacityMembers'
import { COMPACT_SELECT } from '@/utils/compactSelect'
import { fmt1, sprintDateRange, sprintLabel } from '@/utils/sprintLabels'
import { todayIso } from '@/utils/workingDays'

interface Props {
  readonly teamId: string
}

/** What a read spans when no sprint can bound it — the year the minimap spans. */
const FALLBACK_MONTHS = 12

/** How much of a PI name the picker keeps. It is a caption, not a column head. */
const SPRINT_LABEL_CHARS = 10

/**
 * Who is in which meeting (teams.md §7.5; design 1g).
 *
 * **A matrix, not a calendar.** Absences are one person's and *when* is their
 * whole content, so they get a calendar. A meeting is shared, its schedule is
 * fixed once and rarely revisited, and what changes week to week is who is in
 * it — which a grid of members against meetings puts on one screen. It also
 * disposes of a layout problem: a 15-minute stand-up and an 8-hour workshop on
 * one timeline are either both unreadable or wildly out of proportion; as columns
 * they are simply two columns.
 *
 * **The load column needs a window the grid cannot imply.** With no time axis,
 * "how many hours does this cost?" has no answer until a sprint is named — so the
 * column head carries the sprint selector, drawn from the anchor project's
 * calendar (§7.0.1). Pick an undated sprint and every total reads "—", never 0;
 * a team with no project keeps its matrix and is told why the totals are empty.
 *
 * **Load is not the same number as cost.** The per-member column is what actually
 * reaches capacity — clamped to the hours that member has after absences — while
 * the footer's person-hours is the meeting's own gross length × attendees. They
 * differ exactly where the clamp bites, which is the case worth seeing.
 */
export function MeetingsView({ teamId }: Props) {
  const canEdit = useAuthStore((s) => s.canEdit())

  const { data: members } = useTeamMembers(teamId)
  const { data: capacity } = useTeamCapacity(teamId)

  const sprints = useMemo(() => capacity?.sprints ?? [], [capacity])
  const [sprintId, setSprintId] = useState<string | null>(null)

  // Default to the sprint in progress, else the next one to start — the window
  // somebody opening this view is almost always asking about.
  useEffect(() => {
    if (sprints.length === 0) {
      setSprintId(null)
      return
    }
    setSprintId((current) =>
      current && sprints.some((s) => s.sprint_id === current) ? current : defaultSprint(sprints),
    )
  }, [sprints])

  const index = sprints.findIndex((s) => s.sprint_id === sprintId)
  const sprint = index >= 0 ? sprints[index] : null
  const computable = Boolean(sprint?.computable && sprint.start_date && sprint.end_date)

  // Occurrences are expanded over the selected sprint, because that is the window
  // the totals count in. Without one, a year — enough for the column heads to
  // describe themselves, which is all the matrix itself needs.
  const window = useMemo(
    () =>
      computable && sprint?.start_date && sprint.end_date
        ? { from: sprint.start_date, to: sprint.end_date }
        : windowOf(monthOf(todayIso()), FALLBACK_MONTHS),
    [computable, sprint],
  )

  const { data: meetings, isLoading } = useMeetings(teamId, window.from, window.to)
  const update = useUpdateMeeting(teamId, window.from, window.to)
  const reorder = useReorderMeetings(teamId, window.from, window.to)
  const remove = useDeleteMeeting(teamId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [deleting, setDeleting] = useState<Meeting | null>(null)
  const [conflict, setConflict] = useState<{ mine: Meeting; theirs: Meeting } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Members who count, then those who do not, as in every team view — here under
  // a heading of their own, because this table has a total to keep them out of.
  const { counted, notCounted } = splitByCapacity(members ?? [])
  const rows: readonly TeamMember[] = [...counted, ...notCounted]
  const columns: readonly Meeting[] = meetings ?? []

  /** Meeting hours per member for the selected sprint — what reaches capacity. */
  const load = useMemo(() => {
    const byMember = new Map<string, number>()
    if (!capacity || index < 0) return byMember
    for (const row of capacity.members) {
      const cell = row.cells[index]
      if (cell) byMember.set(row.member_id, cell.meeting_hours)
    }
    return byMember
  }, [capacity, index])

  const attendance = (meeting: Meeting, memberId: string) =>
    attendeesOf(meeting).includes(memberId)

  const write = async (meeting: Meeting, memberIds: string[]) => {
    setError(null)
    try {
      await update.mutateAsync({
        meetingId: meeting.system_id,
        etag: meeting.etag ?? '',
        body: { member_ids: memberIds },
      })
    } catch (err) {
      const theirs = staleMeeting(err)
      if (theirs) {
        // The column moved under the click. Both versions on screen, and the
        // reader chooses — never a silent refetch (§4.2).
        setConflict({ mine: { ...meeting, member_ids: memberIds }, theirs })
        return
      }
      setError('Could not save that attendance change — please try again.')
    }
  }

  const toggleCell = (meeting: Meeting, memberId: string) =>
    write(
      meeting,
      attendance(meeting, memberId)
        ? attendeesOf(meeting).filter((id) => id !== memberId)
        : [...attendeesOf(meeting), memberId],
    )

  const toggleColumn = (meeting: Meeting) => {
    const everyone = rows.length > 0 && rows.every((m) => attendance(meeting, m.system_id))
    return write(meeting, everyone ? [] : rows.map((m) => m.system_id))
  }

  /**
   * A whole member, across every meeting.
   *
   * One request per column, in sequence rather than in parallel: each carries its
   * own `If-Match`, and firing them together would make a 412 on one arrive while
   * the others were still deciding.
   */
  const toggleMemberRow = async (memberId: string) => {
    const everywhere = columns.length > 0 && columns.every((m) => attendance(m, memberId))
    for (const meeting of columns) {
      const attends = attendance(meeting, memberId)
      if (everywhere === attends) await toggleCell(meeting, memberId)
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= columns.length || from === to) return
    const order = columns.map((m) => m.system_id)
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    reorder.mutate(order)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(
      columns.findIndex((m) => m.system_id === active.id),
      columns.findIndex((m) => m.system_id === over.id),
    )
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setError(null)
    try {
      await remove.mutateAsync({ meetingId: deleting.system_id, etag: deleting.etag ?? '' })
      setDeleting(null)
    } catch (err) {
      setError(
        meetingErrorCode(err) === 'STALE'
          ? 'That meeting changed under you — it has been refreshed. Try again.'
          : 'Could not delete that meeting — please try again.',
      )
      setDeleting(null)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (meeting: Meeting) => {
    setEditing(meeting)
    setDialogOpen(true)
  }

  // The total is what meetings take off the *team's* capacity, so it sums the
  // same people the Capacity view's Team row does; the rest is shown beside it.
  const sumLoad = (people: readonly TeamMember[]) =>
    people.reduce((sum, member) => sum + (load.get(member.system_id) ?? 0), 0)
  const totalLoad = sumLoad(counted)
  const notCountedLoad = sumLoad(notCounted)

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Meetings</h2>
        {canEdit && (
          <button
            type="button"
            onClick={openAdd}
            className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover"
          >
            + Add meeting
          </button>
        )}
        <p className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          One column per meeting · cells are attendance
        </p>
      </div>

      <CapacityMembersSummary members={rows} />

      {isLoading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading meetings…</p>
      ) : columns.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">
            No meetings yet — a meeting is a column here, and its cells say who attends.
          </p>
          {canEdit && (
            <button
              onClick={openAdd}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Add the first meeting
            </button>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {/* The card is as wide as its columns, not as wide as the page: a
              matrix whose width is the number of meetings says how many there
              are at a glance, where a stretched one leaves the reader to find
              the last column somewhere off to the right. `max-w-full` keeps the
              scroller in play once there are more meetings than fit. */}
          <div className="w-fit max-w-full overflow-x-auto bg-canvas shadow-soft rounded-xl">
            <table className="text-sm">
              <thead>
                <tr className="bg-band/40 border-b-2 border-gray-700 dark:border-gray-300">
                  {/* No column takes the slack, because there is none to take:
                      the table is shrink-to-fit, so every column is the width it
                      asked for and the names column is the width of the longest
                      name — with a floor, so a team of Als still gets a column
                      that reads as one. */}
                  <th
                    scope="col"
                    className="align-bottom px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[11rem]"
                  >
                    Member
                  </th>
                  <SortableContext
                    items={columns.map((m) => m.system_id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {columns.map((meeting, position) => (
                      <MeetingColumnHead
                        key={meeting.system_id}
                        meeting={meeting}
                        canEdit={canEdit}
                        allAttending={
                          rows.length > 0 && rows.every((m) => attendance(meeting, m.system_id))
                        }
                        someAttending={rows.some((m) => attendance(meeting, m.system_id))}
                        onToggleColumn={() => void toggleColumn(meeting)}
                        onEdit={() => openEdit(meeting)}
                        onDelete={() => setDeleting(meeting)}
                        onMoveLeft={() => move(position, position - 1)}
                        onMoveRight={() => move(position, position + 1)}
                        isFirst={position === 0}
                        isLast={position === columns.length - 1}
                      />
                    ))}
                  </SortableContext>
                  {/* Narrow and right-aligned, like the figures beneath it: the
                      column holds "4.0 h", and the sprint picker is a caption on
                      that number rather than a form the header has to fit. */}
                  <th
                    scope="col"
                    className="align-top px-3 py-3 text-right w-40 border-l-2 border-gray-700 dark:border-gray-300"
                  >
                    <span className="block text-xs font-semibold text-gray-800 dark:text-gray-100">
                      Meeting load
                    </span>
                    <SprintPicker
                      sprints={sprints}
                      index={index}
                      anchorName={capacity?.projects[0]?.name ?? null}
                      onSelect={setSprintId}
                    />
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/60">
                {rows.map((member, index) => (
                  <Fragment key={member.system_id}>
                  {index === counted.length && (
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={columns.length + 2}
                        className="px-4 pt-5 pb-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                      >
                        Not counted towards capacity
                      </th>
                    </tr>
                  )}
                    <tr className="hover:bg-band/20">
                      <th scope="row" className="px-4 py-2 text-left">
                        {/* The row header selects the whole member — "Marta is in
                            everything" — mirroring the column head's own toggle. */}
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => void toggleMemberRow(member.system_id)}
                          title={canEdit ? 'Attends every meeting / none' : undefined}
                          // A ceiling on the one column that is sized by its
                          // content: without it a single pasted 200-character name
                          // would set the width of the whole table.
                          className="block truncate max-w-[16rem] text-sm font-medium text-gray-900 dark:text-gray-100 disabled:cursor-default hover:enabled:text-blue-600"
                        >
                          {member.name}
                        </button>
                      </th>
                      {columns.map((meeting) => (
                        <td
                          key={meeting.system_id}
                          className="px-3 py-2 text-center border-l border-white/60 dark:border-white/10"
                        >
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={attendance(meeting, member.system_id)}
                            onChange={() => void toggleCell(meeting, member.system_id)}
                            aria-label={`${member.name} attends ${meeting.title}`}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800 dark:text-gray-100 border-l-2 border-gray-700 dark:border-gray-300 tabular-nums">
                        {computable ? `${fmt1(load.get(member.system_id) ?? 0)} h` : '—'}
                      </td>
                    </tr>
                  </Fragment>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500"
                    >
                      Nobody on this team yet — add a member before saying who attends.
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot>
                <tr className="bg-band/40 border-t border-white/60 dark:border-white/10">
                  <th scope="row" className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">
                    Attending
                  </th>
                  {columns.map((meeting) => (
                    <td
                      key={meeting.system_id}
                      className="px-3 py-2 text-center text-xs text-gray-600 dark:text-gray-300 border-l border-white/60 dark:border-white/10"
                    >
                      <span className="block">
                        {attendeesOf(meeting).length} of {rows.length}
                      </span>
                      <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                        {computable ? `${fmt1(personHours(meeting))} ph` : '—'}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800 dark:text-gray-100 border-l-2 border-gray-700 dark:border-gray-300 tabular-nums">
                    {computable ? `${fmt1(totalLoad)} h` : '—'}
                    {computable && notCountedLoad > 0 && (
                      <span className="block text-[11px] font-normal text-gray-400 dark:text-gray-500">
                        +{fmt1(notCountedLoad)} h not counted
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </DndContext>
      )}

      {columns.length > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 max-w-3xl">
          Load is what reaches capacity: a meeting is charged to the day it starts in and clamped to
          the hours that member still has, so a meeting on an absent morning costs nothing and a
          workshop longer than someone&rsquo;s day stops at their day. The footer&rsquo;s person-hours are
          the meeting&rsquo;s own length × attendees.
        </p>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {conflict && (
        <ConflictBanner
          mine={conflict.mine}
          theirs={conflict.theirs}
          onKeepTheirs={() => setConflict(null)}
          onReapplyMine={() => {
            const mine = conflict.mine
            setConflict(null)
            void write({ ...conflict.theirs }, [...attendeesOf(mine)])
          }}
        />
      )}

      <MeetingDialog
        open={dialogOpen}
        teamId={teamId}
        members={rows}
        window={window}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onStale={(mine, theirs) => setConflict({ mine, theirs })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete meeting"
        description={deleting ? deletePrompt(deleting) : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/**
 * What one meeting costs in person-hours over the selected sprint.
 *
 * The **gross** figure: occurrences × length × attendees, unclamped. It answers
 * "what are we spending on this meeting", which is a question about the meeting;
 * the per-member load column answers "what does this cost that person's
 * capacity", which is a question about their day and is clamped to it.
 */
export function personHours(meeting: Meeting): number {
  return (
    occurrencesOf(meeting).length * (meeting.duration_minutes / 60) * attendeesOf(meeting).length
  )
}

/**
 * What the confirm says, and what it deliberately does not ask.
 *
 * A recurring meeting goes as a whole and the prompt names that — there is no
 * "this occurrence / the whole series" choice, because there is no such thing as
 * one occurrence in the model (§3.4).
 */
export function deletePrompt(meeting: Meeting): string {
  const what = `‘${meeting.title}’ — ${formatDuration(meeting.duration_minutes)}, ${meeting.summary}`
  return meeting.kind === 'range'
    ? `Delete ${what}? This cannot be undone.`
    : `Delete ${what} — every occurrence? This cannot be undone.`
}

/** The sprint in progress today, else the next to start, else the first. */
function defaultSprint(sprints: readonly CapacitySprint[]): string {
  const today = todayIso()
  const current = sprints.find(
    (s) => s.start_date && s.end_date && s.start_date <= today && today <= s.end_date,
  )
  if (current) return current.sprint_id
  const next = sprints.find((s) => s.start_date && s.start_date > today)
  return (next ?? sprints[0]).sprint_id
}

interface SprintPickerProps {
  readonly sprints: readonly CapacitySprint[]
  readonly index: number
  readonly anchorName: string | null
  readonly onSelect: (sprintId: string) => void
}

/**
 * The window the load column counts in (§7.0.1).
 *
 * It sits in this column head and nowhere else because it is the only
 * sprint-dependent thing on the screen: attendance is attendance whatever week it
 * is. The sprints come from the team's **anchor project** — the first one it
 * serves — and a team with none says so rather than inventing a calendar.
 */
function SprintPicker({ sprints, index, anchorName, onSelect }: SprintPickerProps) {
  if (sprints.length === 0) {
    return (
      <span className="mt-1 block text-[11px] font-normal text-amber-700 dark:text-amber-400">
        No project assigned, so this team has no sprint calendar to total in.
      </span>
    )
  }

  const sprint = index >= 0 ? sprints[index] : null
  const dated = Boolean(sprint?.start_date && sprint?.end_date)

  return (
    <>
      <div className="mt-1 flex items-center justify-end gap-1">
        <select
          aria-label="Sprint for meeting load"
          value={sprint?.sprint_id ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          // Sized to its own longest label, not stretched to the column: a
          // control the width of "PI 8.2" that spans the whole header reads as a
          // text field somebody forgot to fill in. `max-w-full` is the only bound
          // — a long PI name still stops at the column's edge.
          //
          // The compact chevron is what makes that width honest: the forms
          // plugin reserves 2.5rem of padding for its arrow, which is most of a
          // control this size.
          style={COMPACT_SELECT}
          className="w-auto max-w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 py-0.5 pl-1.5 text-[11px] font-normal focus:border-blue-500 focus:ring-blue-500"
        >
          {sprints.map((option) => (
            <option key={option.sprint_id} value={option.sprint_id}>
              {/* Shorter than the Capacity view's columns allow, because this one
                  is a caption: the PI part truncates, the sprint number never
                  does — it is the half that tells adjacent sprints apart. */}
              {sprintLabel(option.pi_name, option.sprint_number, SPRINT_LABEL_CHARS)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Earlier sprint"
          disabled={index <= 0}
          onClick={() => onSelect(sprints[index - 1].sprint_id)}
          className="px-1.5 rounded-md bg-canvas shadow-soft-sm text-[11px] text-gray-500 disabled:opacity-30"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Later sprint"
          disabled={index < 0 || index >= sprints.length - 1}
          onClick={() => onSelect(sprints[index + 1].sprint_id)}
          className="px-1.5 rounded-md bg-canvas shadow-soft-sm text-[11px] text-gray-500 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <span
        className={`mt-1 block text-[10px] font-normal ${
          dated ? 'text-gray-400 dark:text-gray-500' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {dated
          ? sprintDateRange(sprint?.start_date ?? null, sprint?.end_date ?? null)
          : 'no dates set'}
        {anchorName ? ` · from ${anchorName}` : ''}
      </span>
    </>
  )
}

interface ConflictProps {
  readonly mine: Meeting
  readonly theirs: Meeting
  readonly onKeepTheirs: () => void
  readonly onReapplyMine: () => void
}

/**
 * 412 — the row changed under you, and here it is (§4.2).
 *
 * Amber, not red: nothing is broken and nothing was lost. Both versions are
 * named, because "please retry" without saying what moved leaves the user to diff
 * two invisible states. This is deliberately not the lock's 409, which means
 * *someone else is editing this project, wait* and looks nothing like it.
 */
function ConflictBanner({ mine, theirs, onKeepTheirs, onReapplyMine }: ConflictProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 p-3 max-w-xl"
    >
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
        This meeting changed under you
      </p>
      <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
        Yours: {attendeesOf(mine).length} attending, {mine.summary}. Theirs:{' '}
        <span className="font-semibold">
          {attendeesOf(theirs).length} attending, {theirs.summary}
        </span>
        .
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onKeepTheirs}
          className="px-3 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-700 dark:text-gray-200 hover:shadow-soft-hover"
        >
          Keep theirs
        </button>
        <button
          type="button"
          onClick={onReapplyMine}
          className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Reapply mine
        </button>
      </div>
    </div>
  )
}
