import { useCallback, useEffect, useMemo, useState } from 'react'
import { AbsenceDialog, type AbsenceDraft } from '@/components/AbsenceDialog'
import { AbsenceGrid, AbsenceLegend } from '@/components/AbsenceGrid'
import { AbsenceMinimap } from '@/components/AbsenceMinimap'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAbsences, useDeleteAbsence } from '@/hooks/useAbsences'
import { useTeamMembers } from '@/hooks/useTeamMembers'
import { absenceErrorCode, staleAbsence } from '@/services/absences'
import { useAuthStore } from '@/stores/authStore'
import { COMPACT_SELECT } from '@/utils/compactSelect'
import type { Absence } from '@/types'
import {
  DEFAULT_STRIP_MONTHS,
  GRID_MONTHS,
  addMonths,
  firstDay,
  monthLabel,
  monthOf,
  monthsFrom,
  occurrenceSummary,
  stripStartFor,
  windowOf,
  type DragRange,
  type YearMonth,
} from '@/utils/absenceGrid'
import { todayIso } from '@/utils/workingDays'

interface Props {
  readonly teamId: string
}

/**
 * When people are away, and what it costs (teams.md §7.4; design 1b).
 *
 * **Two zoom levels, stacked.** Absences are entered years ahead — annual leave
 * twelve months out is ordinary — so a fixed span around today would not reach
 * the data. The minimap spans a year and shows where entries are; the grid
 * below shows four months of half-days; the frame joins them.
 *
 * **A drag never writes.** It opens the dialog pre-filled from the rectangle,
 * because the range is a guess about intent and the label, the kind and the
 * exact halves are not. This is also why the drop and the "+ Add absence" button
 * lead to the same place.
 *
 * **412 gets a banner, not a spinner.** A stale write means the row moved under
 * you, and the honest response is to show both versions and let the user choose
 * — *keep theirs* is already on screen once the list refetches, and *reapply
 * mine* re-opens the dialog with what was being written (§4.2).
 */
export function AbsencesView({ teamId }: Props) {
  const canEdit = useAuthStore((s) => s.canEdit())

  // The minimap's year opens on the current month, and the grid on the same
  // month — the two only diverge once the frame is dragged.
  const [minimapStart, setMinimapStart] = useState<YearMonth>(() => monthOf(todayIso()))
  const [gridStart, setGridStart] = useState<YearMonth>(() => monthOf(todayIso()))

  // How many months the density strip carries — measured by it, owned here,
  // because the same number decides the window the absences are fetched over.
  const [stripMonths, setStripMonths] = useState(DEFAULT_STRIP_MONTHS)

  const year = windowOf(minimapStart, stripMonths)
  const grid = windowOf(gridStart, GRID_MONTHS)

  /**
   * Move the calendar so *target* is its first month.
   *
   * The strip follows only when it has to. Every way of moving the viewport —
   * a month click, the jump, the frame — goes through here, so all three land
   * the calendar in the same place for the same month.
   */
  const showMonth = useCallback(
    (target: YearMonth) => {
      setGridStart(target)
      setMinimapStart((current) => stripStartFor(current, target, stripMonths, GRID_MONTHS))
    },
    [stripMonths],
  )

  // A strip that grew or shrank can leave the frame outside it — three years of
  // columns on a wide screen, one when the window is dragged narrow. Re-anchor
  // on the months already on screen rather than moving the reader.
  useEffect(() => {
    setMinimapStart((current) => stripStartFor(current, gridStart, stripMonths, GRID_MONTHS))
  }, [stripMonths, gridStart])

  // Members are read as of the grid's first day: the tint marking a non-working
  // half-day comes from the contract in force then. It is a display hint — the
  // capacity maths resolves the version per half-day regardless (§5.4).
  const { data: members } = useTeamMembers(teamId, firstDay(gridStart))
  const { data: absences, isLoading } = useAbsences(teamId, year.from, year.to)
  const remove = useDeleteAbsence(teamId)

  const [draft, setDraft] = useState<AbsenceDraft | null>(null)
  const [editing, setEditing] = useState<Absence | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<Absence | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [conflict, setConflict] = useState<{ mine: Absence; theirs: Absence } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => members ?? [], [members])
  const entries = useMemo(() => absences ?? [], [absences])

  // The grid draws only its own four months; the minimap keeps the whole year.
  const visible = useMemo(
    () =>
      entries.map((absence) => ({
        ...absence,
        occurrences: (absence.occurrences ?? []).filter(
          (o) => o.date >= grid.from && o.date <= grid.to,
        ),
      })),
    [entries, grid.from, grid.to],
  )

  const current = selected ? (entries.find((a) => a.system_id === selected.system_id) ?? null) : null

  const openBlank = () => {
    setDraft(null)
    setEditing(null)
    setDialogOpen(true)
  }

  const openFromDrag = (range: DragRange) => {
    setEditing(null)
    setDraft({
      memberIds: rows.slice(range.memberFrom, range.memberTo + 1).map((m) => m.system_id),
      from: range.from,
      to: range.to,
      startHalf: range.startHalf,
      endHalf: range.endHalf,
    })
    setDialogOpen(true)
  }

  const openForEdit = (absence: Absence) => {
    setDraft(null)
    setEditing(absence)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!current) return
    setError(null)
    try {
      await remove.mutateAsync({ absenceId: current.system_id, etag: current.etag ?? '' })
      setSelected(null)
      setConfirming(false)
    } catch (err) {
      const theirs = staleAbsence(err)
      if (theirs) {
        // Roll the optimistic selection back to what the server holds, then let
        // the banner ask — never a silent refetch (§4.2).
        setConflict({ mine: current, theirs })
        setSelected(theirs)
        setConfirming(false)
        return
      }
      setError(
        absenceErrorCode(err) === 'IF_MATCH_REQUIRED'
          ? 'That entry could not be deleted safely. Reload and try again.'
          : 'Could not delete that entry — please try again.',
      )
    }
  }

  const shownMonths = monthsFrom(gridStart, GRID_MONTHS)

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Absences</h2>
        {canEdit && (
          <button
            type="button"
            onClick={openBlank}
            className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover"
          >
            + Add absence
          </button>
        )}
        <p className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {canEdit ? 'Drag across cells to create · click an entry to edit' : 'Read-only'}
        </p>
      </div>

      <div className="bg-canvas shadow-soft rounded-xl p-4 space-y-4">
        <AbsenceMinimap
          windowStart={minimapStart}
          gridStart={gridStart}
          absences={entries}
          onGridStart={showMonth}
          stripMonths={stripMonths}
          onStripMonths={setStripMonths}
        >
          {/* Under the strip's own label, because it moves the same viewport —
              reaching September 2028 by dragging is not a feature (§7.4). */}
          {/* Deliberately quiet: the frame and the month bars are the primary
              controls, and this is the fallback for a month too far to drag to.
              A full-width select read as the main affordance it is not. */}
          <label className="flex items-baseline gap-1 text-[11px] text-gray-400 dark:text-gray-500">
            Jump to
            <select
              aria-label="Jump to month"
              value={`${gridStart.year}-${String(gridStart.month).padStart(2, '0')}`}
              onChange={(event) => showMonth(monthOf(`${event.target.value}-01`))}
              className="min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 pl-1 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-band/60 focus:ring-1 focus:ring-blue-500"
              style={COMPACT_SELECT}
            >
              {monthsFrom(addMonths(monthOf(todayIso()), -12), 36).map((month) => (
                <option
                  key={`${month.year}-${month.month}`}
                  value={`${month.year}-${String(month.month).padStart(2, '0')}`}
                >
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>
        </AbsenceMinimap>

        <p className="sr-only" aria-live="polite">
          Showing {monthLabel(shownMonths[0])} to {monthLabel(shownMonths[shownMonths.length - 1])}
        </p>

        {isLoading ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading absences…</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            Nobody on this team yet — add a member before recording who is away.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <AbsenceGrid
              members={rows}
              absences={visible}
              from={grid.from}
              to={grid.to}
              selectedId={current?.system_id ?? null}
              canEdit={canEdit}
              onSelect={setSelected}
              onDraft={openFromDrag}
              onDeleteSelected={() => setConfirming(true)}
            />
          </div>
        )}

        <AbsenceLegend />
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {conflict && (
        <ConflictBanner
          mine={conflict.mine}
          theirs={conflict.theirs}
          onKeepTheirs={() => setConflict(null)}
          onReapplyMine={() => {
            const mine = conflict.mine
            setConflict(null)
            openForEdit({ ...conflict.theirs, ...ruleOf(mine), etag: conflict.theirs.etag })
          }}
        />
      )}

      {current && (
        <SelectedEntry
          absence={current}
          memberName={rows.find((m) => m.system_id === current.member_id)?.name ?? 'Unknown'}
          canEdit={canEdit}
          onEdit={() => openForEdit(current)}
          onDelete={() => setConfirming(true)}
        />
      )}

      <AbsenceDialog
        open={dialogOpen}
        teamId={teamId}
        members={rows}
        window={year}
        draft={draft}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onStale={(mine, theirs) => {
          setConflict({ mine, theirs })
          setSelected(theirs)
        }}
      />

      <ConfirmDialog
        open={confirming}
        title="Delete absence"
        description={
          current
            ? deletePrompt(current, rows.find((m) => m.system_id === current.member_id)?.name)
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/**
 * What the confirm says, and what it deliberately does not ask.
 *
 * A recurring entry goes as a whole and the prompt names that — there is no
 * "this occurrence / the whole series" choice, because there is no such thing as
 * one occurrence in the model (§3.4).
 */
export function deletePrompt(absence: Absence, memberName?: string): string {
  const who = memberName ? ` for ${memberName}` : ''
  const named = absence.label ? ` ‘${absence.label}’` : ''
  return absence.kind === 'range'
    ? `Delete${named}${who} — ${absence.summary}? This cannot be undone.`
    : `Delete${named}${who} — every occurrence, ${absence.summary}? This cannot be undone.`
}

/** The schedule half of a row, for reapplying a losing edit onto the winner. */
function ruleOf(absence: Absence) {
  const { kind, label, start_date, end_date, start_half, end_half, weekday, halves, interval_weeks } =
    absence
  return { kind, label, start_date, end_date, start_half, end_half, weekday, halves, interval_weeks }
}

interface SelectedProps {
  readonly absence: Absence
  readonly memberName: string
  readonly canEdit: boolean
  readonly onEdit: () => void
  readonly onDelete: () => void
}

/**
 * The bar under the grid: one selected entry, with **delete as its own action**.
 *
 * The bin sits beside the pencil rather than inside the edit dialog, because
 * removing an entry is what people most often come here to do and burying it
 * behind an edit makes it a two-step. The Delete key does the same thing.
 */
function SelectedEntry({ absence, memberName, canEdit, onEdit, onDelete }: SelectedProps) {
  return (
    <div className="bg-canvas shadow-soft rounded-xl p-3 max-w-md flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{memberName}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300">{occurrenceSummary(absence)}</p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          {absence.label ? `‘${absence.label}’ · ` : ''}
          {absence.summary}
        </p>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit absence for ${memberName}`}
            className="px-2 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete absence for ${memberName}`}
            className="px-2 py-1 text-xs rounded-lg bg-canvas shadow-soft-sm text-red-600 hover:shadow-soft-hover"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

interface ConflictProps {
  readonly mine: Absence
  readonly theirs: Absence
  readonly onKeepTheirs: () => void
  readonly onReapplyMine: () => void
}

/**
 * 412 — the row changed under you, and here it is (§4.2).
 *
 * Amber, not red: nothing is broken and nothing was lost. Both versions are
 * named, because "please retry" without saying what moved leaves the user to
 * diff two invisible states. This is deliberately not the lock's 409, which
 * means *someone else is editing this project, wait* and looks nothing like it.
 */
function ConflictBanner({ mine, theirs, onKeepTheirs, onReapplyMine }: ConflictProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 p-3 max-w-xl"
    >
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
        This absence changed under you
      </p>
      <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
        Yours: {mine.summary}. Theirs: <span className="font-semibold">{theirs.summary}</span>.
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
