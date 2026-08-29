import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AxiosError } from 'axios'
import { parseImportCSV, buildPreview, selectImportRows } from '@/utils/csvParser'
import type { ImportPreview, ParsedRow, ParseResult } from '@/utils/csvParser'
import { useCsvImport } from '@/hooks/useCsvImport'
import type { CsvImportResult, Feature, PBI, PI } from '@/types'

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly file: File | null
  readonly features: readonly Feature[]
  readonly pbis: readonly PBI[]
  readonly pis: readonly PI[]
  readonly onClose: () => void
}

type Step = 'preview' | 'reconcile' | 'importing' | 'done' | 'error'

interface ServerError {
  row: number
  message: string
}

/** A Removed CSV row that matches an item already in the project. */
interface RemovalCandidate {
  userId: number
  title: string
  systemId: string
  isFeature: boolean
  parentSystemId: string | null  // for stories: the existing parent feature's system_id
  /** Where it lives, so a board item is never mistaken for a backlog stub. */
  piNames: string[]
  /** Stories deleted with it — its own, plus those of its continuations. */
  storyCount: number
  /** Continuations in later PIs, which are deleted with their origin. */
  continuationCount: number
}

/**
 * Every feature deleted along with this one: its continuations, transitively.
 *
 * A continuation is the same feature carried into a later PI, so it cannot
 * outlive its origin — the backend deletes the whole lineage. Counting it here is
 * what stops the confirmation understating the damage.
 */
function lineageOf(systemId: string, features: readonly Feature[]): Feature[] {
  const found: Feature[] = []
  const seen = new Set<string>([systemId])
  let frontier = [systemId]

  while (frontier.length > 0) {
    const next = features.filter(
      (f) => f.continued_from_feature_id !== null
        && frontier.includes(f.continued_from_feature_id)
        && !seen.has(f.system_id),
    )
    for (const f of next) seen.add(f.system_id)
    found.push(...next)
    frontier = next.map((f) => f.system_id)
  }
  return found
}

/** An existing story whose Parent names a different feature in this file. */
interface Reparent {
  storyId: number
  systemId: string
  title: string
  fromTitle: string
  toTitle: string
  /** Sitting in a group — the move takes it out of its sprint. */
  isPlaced: boolean
}

/**
 * Stories the file wants to move to a different feature.
 *
 * A member of the same continuation lineage does not count: that is a split
 * someone made on the board, and the CSV has no way to express it, so reading it
 * as a move would undo the split on every refresh. The backend applies the same
 * rule — this is here so the preview can offer the choice before it happens.
 */
function computeReparents(
  rows: readonly ParsedRow[],
  features: readonly Feature[],
  pbis: readonly PBI[],
): Reparent[] {
  const featureById = new Map<number, Feature>()
  for (const f of features) if (f.id != null) featureById.set(f.id, f)
  const featureBySysId = new Map(features.map((f) => [f.system_id, f]))
  const pbiById = new Map<number, PBI>()
  for (const p of pbis) if (p.id != null) pbiById.set(p.id, p)
  const fileFeatureTitles = new Map<number, string>()
  for (const r of rows) if (r.itemType === 'feature' && r.userId != null) fileFeatureTitles.set(r.userId, r.title)

  const moves: Reparent[] = []
  for (const row of rows) {
    if (row.itemType === 'feature' || row.userId === null || row.parentId === null) continue
    const pbi = pbiById.get(row.userId)
    if (!pbi) continue  // a new story, not a move

    const target = featureById.get(row.parentId)
    if (target) {
      // Already somewhere in the target's lineage? Then nothing has moved.
      const members = new Set([target.system_id, ...lineageOf(target.system_id, features).map((f) => f.system_id)])
      if (members.has(pbi.parent_feature_system_id)) continue
    } else if (!fileFeatureTitles.has(row.parentId)) {
      continue  // Parent resolves to nothing — the story stays where it is
    }

    moves.push({
      storyId: row.userId,
      systemId: pbi.system_id,
      title: pbi.title,
      fromTitle: featureBySysId.get(pbi.parent_feature_system_id)?.title ?? 'another feature',
      toTitle: target?.title ?? fileFeatureTitles.get(row.parentId) ?? 'a new feature',
      isPlaced: pbi.group_id != null,
    })
  }
  return moves
}

/** An ID the project holds under the other entity type. */
interface TypeChange {
  userId: number
  title: string
  /** story/bug → Feature. The reverse is reported but never applied. */
  promotion: boolean
  /** Sitting in a group — promoting it takes the sprint placement too. */
  isPlaced: boolean
}

function computeTypeChanges(
  rows: readonly ParsedRow[],
  features: readonly Feature[],
  pbis: readonly PBI[],
): TypeChange[] {
  const featureIds = new Set(features.map((f) => f.id).filter((id): id is number => id != null))
  const pbiById = new Map<number, PBI>()
  for (const p of pbis) if (p.id != null) pbiById.set(p.id, p)

  const changes: TypeChange[] = []
  for (const row of rows) {
    if (row.userId === null) continue
    const asStory = pbiById.get(row.userId)
    if (row.itemType === 'feature' && asStory) {
      changes.push({ userId: row.userId, title: row.title, promotion: true, isPlaced: asStory.group_id != null })
    } else if (row.itemType !== 'feature' && featureIds.has(row.userId)) {
      changes.push({ userId: row.userId, title: row.title, promotion: false, isPlaced: false })
    }
  }
  return changes
}

function parsedRowToCsvRow(r: ParsedRow) {
  return {
    row_number: r.rowNumber,
    item_type: r.itemType,
    user_id: r.userId,
    title: r.title,
    effort: r.effort,
    parent_id: r.parentId,
    state: r.state,
  }
}

function featureCandidate(
  userId: number,
  feature: Feature,
  features: readonly Feature[],
  pbis: readonly PBI[],
  piName: (piId: string | null) => string,
): RemovalCandidate {
  const lineage = [feature, ...lineageOf(feature.system_id, features)]
  const doomed = new Set(lineage.map((f) => f.system_id))
  return {
    userId,
    title: feature.title,
    systemId: feature.system_id,
    isFeature: true,
    parentSystemId: null,
    piNames: lineage.filter((f) => f.location === 'pi').map((f) => piName(f.pi_id)),
    storyCount: pbis.filter((p) => doomed.has(p.parent_feature_system_id)).length,
    continuationCount: lineage.length - 1,
  }
}

function storyCandidate(
  userId: number,
  pbi: PBI,
  features: readonly Feature[],
  piName: (piId: string | null) => string,
): RemovalCandidate {
  const parent = features.find((f) => f.system_id === pbi.parent_feature_system_id)
  return {
    userId,
    title: pbi.title,
    systemId: pbi.system_id,
    isFeature: false,
    parentSystemId: pbi.parent_feature_system_id,
    piNames: parent?.location === 'pi' ? [piName(parent.pi_id)] : [],
    storyCount: 0,
    continuationCount: 0,
  }
}

/** Match Removed rows (by ID) against items already in the project. */
function computeCandidates(
  removedItems: ParsedRow[],
  features: readonly Feature[],
  pbis: readonly PBI[],
  pis: readonly PI[],
): RemovalCandidate[] {
  const featureById = new Map<number, Feature>()
  for (const f of features) if (f.id != null) featureById.set(f.id, f)
  const pbiById = new Map<number, PBI>()
  for (const p of pbis) if (p.id != null) pbiById.set(p.id, p)
  const piName = (piId: string | null) =>
    pis.find((p) => p.system_id === piId)?.name ?? 'a PI'

  const candidates: RemovalCandidate[] = []
  const seen = new Set<number>()
  for (const item of removedItems) {
    if (item.userId === null || seen.has(item.userId)) continue

    const feature = featureById.get(item.userId)
    const pbi = feature ? undefined : pbiById.get(item.userId)
    if (feature) {
      candidates.push(featureCandidate(item.userId, feature, features, pbis, piName))
    } else if (pbi) {
      candidates.push(storyCandidate(item.userId, pbi, features, piName))
    } else {
      continue
    }
    seen.add(item.userId)
  }
  // Features first, then stories
  return candidates.sort((a, b) => Number(b.isFeature) - Number(a.isFeature))
}

/** Items that will actually be destroyed, which is more than the rows ticked. */
function totalDeleted(candidates: RemovalCandidate[], selected: ReadonlySet<string>): number {
  return candidates
    .filter((c) => selected.has(c.systemId))
    .reduce((n, c) => n + 1 + c.continuationCount + c.storyCount, 0)
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function PreviewTable({ preview }: { readonly preview: ImportPreview }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-gray-100">
        <tr>
          <td className="py-1.5 text-gray-500">Rows in file</td>
          <td className="py-1.5 text-right font-medium text-gray-800">{preview.totalRows}</td>
        </tr>
        <tr>
          <td className="py-1.5 text-gray-500">Removed (filtered out)</td>
          <td className="py-1.5 text-right font-medium text-gray-800">{preview.removedRows}</td>
        </tr>
        {preview.childrenRemovedWithParent > 0 && (
          <tr>
            <td className="py-1.5 text-gray-500 text-xs">
              ↳ {preview.childrenRemovedWithParent} child {preview.childrenRemovedWithParent === 1 ? 'story' : 'stories'} dropped (parent feature removed)
            </td>
            <td />
          </tr>
        )}
        <tr>
          <td className="py-1.5 text-gray-500">Features to import</td>
          <td className="py-1.5 text-right font-medium text-gray-800">{preview.featureCount}</td>
        </tr>
        <tr>
          <td className="py-1.5 text-gray-500">Stories to import</td>
          <td className="py-1.5 text-right font-medium text-gray-800">{preview.storyCount}</td>
        </tr>
        {preview.orphanCount > 0 && (
          <tr>
            <td className="py-1.5 text-amber-600 text-xs">
              ↳ {preview.orphanCount} orphan {preview.orphanCount === 1 ? 'story' : 'stories'} (no parent in this file or the project) — new ones go to &quot;Unassigned&quot;, ones already in the project stay where they are
            </td>
            <td />
          </tr>
        )}
        {preview.hasStateColumn && preview.stateValues.length > 0 && (
          <tr>
            <td className="py-1.5 text-gray-500">
              States found{' '}
              <span className="block text-xs text-gray-400">{preview.stateValues.join(', ')}</span>
            </td>
            <td className="py-1.5 text-right font-medium text-gray-800 align-top">
              {preview.stateValues.length}
            </td>
          </tr>
        )}
        {!preview.hasStateColumn && (
          <tr>
            <td className="py-1.5 text-gray-400 text-xs" colSpan={2}>
              No State column in this file — existing States will be left unchanged.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** The Parent-changed opt-in. Off by default: a move can pull a story off a board. */
function ReparentPanel({
  moves, apply, onToggle,
}: {
  readonly moves: Reparent[]
  readonly apply: boolean
  readonly onToggle: (v: boolean) => void
}) {
  const placed = moves.filter((m) => m.isPlaced).length
  return (
    <div className="mt-4 border border-gray-200 rounded-md p-3">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 accent-blue-600"
          checked={apply}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-xs text-gray-700">
          <span className="font-medium">
            {moves.length} {moves.length === 1 ? 'story has' : 'stories have'} moved to a different
            feature in this file
          </span>
          <span className="block text-gray-500 mt-0.5">
            Tick to apply the moves. Left unticked they stay where they are, and the planner keeps
            a hierarchy the source no longer has.
          </span>
        </span>
      </label>

      <ul className="mt-2 space-y-0.5 max-h-28 overflow-y-auto">
        {moves.slice(0, 8).map((m) => (
          <li key={m.systemId} className="text-xs text-gray-500">
            <span className="font-mono text-gray-400">[{m.storyId}]</span> {m.title}:{' '}
            {m.fromTitle} → <span className="text-gray-700">{m.toTitle}</span>
          </li>
        ))}
        {moves.length > 8 && (
          <li className="text-xs text-gray-400">…and {moves.length - 8} more</li>
        )}
      </ul>

      {apply && placed > 0 && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          {placed} of {moves.length === 1 ? 'these' : 'them'} {placed === 1 ? 'is' : 'are'} placed in
          a sprint and will lose that placement.
        </p>
      )}
    </div>
  )
}

/** Type-change opt-in. Promotions are applicable; demotions are only reported. */
function TypeChangePanel({
  changes, apply, onToggle,
}: {
  readonly changes: TypeChange[]
  readonly apply: boolean
  readonly onToggle: (v: boolean) => void
}) {
  const promotions = changes.filter((c) => c.promotion)
  const demotions = changes.filter((c) => !c.promotion)
  const placed = promotions.filter((c) => c.isPlaced).length

  return (
    <div className="mt-4 border border-gray-200 rounded-md p-3">
      {promotions.length > 0 && (
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 accent-blue-600"
            checked={apply}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="text-xs text-gray-700">
            <span className="font-medium">
              {promotions.length} {promotions.length === 1 ? 'story is' : 'stories are'} a feature in
              this file
            </span>
            <span className="block text-gray-500 mt-0.5">
              Tick to convert {promotions.length === 1 ? 'it' : 'them'}. Left unticked
              {promotions.length === 1 ? ' it stays' : ' they stay'} a story and the row is skipped.
            </span>
          </span>
        </label>
      )}

      <ul className={`space-y-0.5 max-h-24 overflow-y-auto ${promotions.length > 0 ? 'mt-2' : ''}`}>
        {promotions.slice(0, 6).map((c) => (
          <li key={`p-${c.userId}`} className="text-xs text-gray-500">
            <span className="font-mono text-gray-400">[{c.userId}]</span> {c.title}: story → feature
          </li>
        ))}
      </ul>

      {apply && placed > 0 && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          {placed} of {promotions.length === 1 ? 'these' : 'them'} {placed === 1 ? 'is' : 'are'}{' '}
          placed in a sprint. A feature is not placed in a sprint, so that placement goes.
        </p>
      )}

      {demotions.length > 0 && (
        <p className={`text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1 ${promotions.length > 0 ? 'mt-2' : ''}`}>
          {demotions.length} {demotions.length === 1 ? 'feature is' : 'features are'} a story in this
          file ({demotions.map((c) => c.userId).join(', ')}). Not converted — a feature can hold
          stories, groups and later-PI parts with nowhere to go. Change it in the app first if you
          want the move.
        </p>
      )}
    </div>
  )
}

function ErrorList({ errors }: { readonly errors: { row: number; message: string }[] }) {
  return (
    <ul className="space-y-1 mt-3 max-h-48 overflow-y-auto">
      {errors.map((e) => (
        <li key={e.row} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
          <span className="font-mono font-medium">Row {e.row}:</span> {e.message}
        </li>
      ))}
    </ul>
  )
}

function ImportingLabel() {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}Importing…
    </span>
  )
}

function ResultRow({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <tr>
      <td className="py-1 text-gray-500">{label}</td>
      <td className="py-1 text-right font-medium text-gray-800">{value}</td>
    </tr>
  )
}

/** Per-item Keep/Remove list for items already in the project re-imported as "Removed". */
function ReconcileList({
  candidates,
  selected,
  forced,
  onToggle,
}: {
  readonly candidates: RemovalCandidate[]
  readonly selected: Set<string>
  readonly forced: Set<string>          // stories forced to Remove because their feature is removed
  readonly onToggle: (systemId: string, remove: boolean) => void
}) {
  return (
    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
      {candidates.map((c) => {
        const isForced = forced.has(c.systemId)
        const willRemove = isForced || selected.has(c.systemId)
        return (
          <li
            key={c.systemId}
            className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border ${willRemove ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
          >
            <div className="min-w-0">
              <p className="text-sm text-gray-900 truncate">
                <span className="font-mono text-xs text-gray-500">[{c.userId}]</span> {c.title}
              </p>
              <p className="text-xs text-gray-400">
                {c.isFeature ? 'Feature' : 'Story'}
                {c.piNames.length > 0 && ` on ${[...new Set(c.piNames)].join(', ')}`}
                {c.piNames.length === 0 && ' in the backlog'}
                {isForced && ' — removed with its parent feature'}
              </p>
              {(c.storyCount > 0 || c.continuationCount > 0) && (
                <p className={`text-xs ${willRemove ? 'text-red-600' : 'text-gray-400'}`}>
                  takes {c.continuationCount > 0 && (
                    <>{c.continuationCount} later-PI {c.continuationCount === 1 ? 'part' : 'parts'}
                      {c.storyCount > 0 && ' and '}</>
                  )}
                  {c.storyCount > 0 && `${c.storyCount} ${c.storyCount === 1 ? 'story' : 'stories'}`}
                </p>
              )}
            </div>
            <label className="flex items-center gap-1.5 shrink-0 text-xs text-gray-600">
              <input
                type="checkbox"
                className="accent-red-600"
                checked={willRemove}
                disabled={isForced}
                onChange={(e) => onToggle(c.systemId, e.target.checked)}
              />
              <span>Remove</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ImportCSVModal({ open, projectId, file, features, pbis, pis, onClose }: Props) {
  const [step, setStep] = useState<Step>('preview')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [candidates, setCandidates] = useState<RemovalCandidate[]>([])
  const [removeSelection, setRemoveSelection] = useState<Set<string>>(new Set())
  const [reparents, setReparents] = useState<Reparent[]>([])
  const [applyReparenting, setApplyReparenting] = useState(false)
  const [typeChanges, setTypeChanges] = useState<TypeChange[]>([])
  const [applyTypeChanges, setApplyTypeChanges] = useState(false)
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const [serverErrors, setServerErrors] = useState<ServerError[]>([])

  const importMutation = useCsvImport(projectId)

  // Project data is read when the file is parsed, but must not re-trigger the
  // parse: a successful import invalidates the features/pbis queries, and the
  // resulting new array identities would otherwise reset the modal back to the
  // preview step and hide the "Import complete" summary.
  const projectItems = useRef({ features, pbis })
  projectItems.current = { features, pbis }
  const projectPIs = useRef(pis)
  projectPIs.current = pis

  // Parse the file whenever a new one is selected and the modal opens
  useEffect(() => {
    if (!open || !file) return
    setStep('preview')
    setPreview(null)
    setParsed(null)
    setCandidates([])
    setRemoveSelection(new Set())
    setReparents([])
    setApplyReparenting(false)
    setTypeChanges([])
    setApplyTypeChanges(false)
    setResult(null)
    setServerErrors([])

    file.text().then((text) => {
      const parseResult: ParseResult = parseImportCSV(text)
      setParsed(parseResult)
      const { features: f, pbis: p } = projectItems.current
      // A Parent resolves against the project as well as the file, so the preview
      // has to know what the project holds or it over-reports orphans.
      setPreview(buildPreview(
        parseResult,
        new Set(f.map((feat) => feat.id).filter((id): id is number => id != null)),
      ))
      setCandidates(computeCandidates(parseResult.removedItems, f, p, projectPIs.current))
      setReparents(computeReparents(selectImportRows(parseResult), f, p))
      setTypeChanges(computeTypeChanges(selectImportRows(parseResult), f, p))
    })
  }, [open, file])

  // Stories whose parent feature is being removed are deleted via cascade — show them
  // as forced Remove (disabled) so the list stays truthful.
  const forced = useMemo(() => {
    const removedFeatureSysIds = new Set(
      candidates.filter((c) => c.isFeature && removeSelection.has(c.systemId)).map((c) => c.systemId),
    )
    const f = new Set<string>()
    for (const c of candidates) {
      if (!c.isFeature && c.parentSystemId && removedFeatureSysIds.has(c.parentSystemId)) {
        f.add(c.systemId)
      }
    }
    return f
  }, [candidates, removeSelection])

  // A Removed feature the user keeps takes its child rows back into the import — the
  // parser holds them precisely so this decision can still go either way.
  const keptRemovedFeatureIds = useMemo(() => {
    const kept = new Set<number>()
    for (const c of candidates) {
      if (c.isFeature && !removeSelection.has(c.systemId)) kept.add(c.userId)
    }
    return kept
  }, [candidates, removeSelection])

  const rowsToImport: ParsedRow[] = useMemo(
    () => (parsed === null ? [] : selectImportRows(parsed, keptRemovedFeatureIds)),
    [parsed, keptRemovedFeatureIds],
  )

  // Child rows that survive only because their feature is being kept — worth naming,
  // since the preview counted them as dropped.
  const keptChildCount =
    parsed === null ? 0 : rowsToImport.length - selectImportRows(parsed).length

  function toggleRemove(systemId: string, remove: boolean) {
    setRemoveSelection((prev) => {
      const next = new Set(prev)
      if (remove) next.add(systemId)
      else next.delete(systemId)
      return next
    })
  }

  function selectAllToRemove() {
    setRemoveSelection(new Set(candidates.map((c) => c.systemId)))
  }

  async function runImport() {
    setStep('importing')
    try {
      // Forced children are handled by cascade, but including them is harmless and explicit.
      const removals = Array.from(new Set([...removeSelection, ...forced]))
      const res = await importMutation.mutateAsync({
        rows: rowsToImport.map(parsedRowToCsvRow),
        removals,
        // A file with no State column must leave every State untouched.
        has_state_column: preview?.hasStateColumn ?? false,
        apply_reparenting: applyReparenting,
        apply_type_changes: applyTypeChanges,
      })
      setResult(res)
      setStep('done')
    } catch (err) {
      const detail = (err as AxiosError<{ detail?: { errors?: ServerError[] } }>)
        ?.response?.data?.detail
      setServerErrors(detail?.errors ?? [])
      setStep('error')
    }
  }

  function handleConfirm() {
    // Reconcile only when there are matched items to decide on.
    if (candidates.length > 0) {
      setStep('reconcile')
      return
    }
    void runImport()
  }

  function handleClose() {
    setStep('preview')
    setPreview(null)
    setParsed(null)
    setCandidates([])
    setRemoveSelection(new Set())
    setReparents([])
    setApplyReparenting(false)
    setTypeChanges([])
    setApplyTypeChanges(false)
    setResult(null)
    setServerErrors([])
    onClose()
  }

  const allRemoved = new Set([...removeSelection, ...forced])
  const removeCount = allRemoved.size
  // Ticking one feature can destroy dozens of items; the row count alone hides that.
  const deleteTotal = totalDeleted(candidates, allRemoved)

  // 'importing' has no screen of its own — it keeps whichever step launched it on
  // display, with a spinner in the Confirm button. Reconcile is reached only when
  // there are candidates, so that alone says which screen to hold.
  const importing = step === 'importing'
  const showReconcile = step === 'reconcile' || (importing && candidates.length > 0)
  const showPreview = step === 'preview' || (importing && candidates.length === 0)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        >

          {/* ── Preview ────────────────────────────────────────────────────── */}
          {showPreview && (
            <>
              <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
                Import CSV
              </Dialog.Title>

              {preview === null ? (
                <p className="text-sm text-gray-400">Parsing file…</p>
              ) : (
                <>
                  <PreviewTable preview={preview} />

                  {typeChanges.length > 0 && !preview.hasErrors && (
                    <TypeChangePanel
                      changes={typeChanges}
                      apply={applyTypeChanges}
                      onToggle={setApplyTypeChanges}
                    />
                  )}

                  {reparents.length > 0 && !preview.hasErrors && (
                    <ReparentPanel
                      moves={reparents}
                      apply={applyReparenting}
                      onToggle={setApplyReparenting}
                    />
                  )}

                  {candidates.length > 0 && !preview.hasErrors && (
                    <p className="mt-4 text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                      {candidates.length} removed {candidates.length === 1 ? 'item' : 'items'} already exist in this project — you&apos;ll choose what to do next.
                    </p>
                  )}

                  {preview.hasErrors && (
                    <div className="mt-4">
                      <p className="text-sm font-medium text-red-700">
                        {preview.errors.length} validation {preview.errors.length === 1 ? 'error' : 'errors'} — fix the CSV and re-select the file
                      </p>
                      <ErrorList errors={preview.errors} />
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={preview === null || preview.hasErrors || importing}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? <ImportingLabel /> : candidates.length > 0 ? 'Next' : 'Confirm Import'}
                </button>
              </div>
            </>
          )}

          {/* ── Reconcile ──────────────────────────────────────────────────── */}
          {showReconcile && (
            <>
              <Dialog.Title className="text-base font-semibold text-gray-900 mb-1">
                Removed items already in the project
              </Dialog.Title>
              <p className="text-xs text-gray-500 mb-3">
                These items are marked &quot;Removed&quot; in the file and already exist. Kept by default — tick to delete permanently.
              </p>

              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={selectAllToRemove}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Select all to remove
                </button>
              </div>

              <ReconcileList
                candidates={candidates}
                selected={removeSelection}
                forced={forced}
                onToggle={toggleRemove}
              />

              {removeCount > 0 && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-4">
                  {removeCount} ticked {removeCount === 1 ? 'item' : 'items'} will delete{' '}
                  <strong>{deleteTotal} {deleteTotal === 1 ? 'item' : 'items'} in total</strong> — a
                  feature takes its stories, and the parts of it carried into later PIs. This cannot
                  be undone.
                </p>
              )}

              {keptChildCount > 0 && (
                <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mt-2">
                  {keptChildCount} child {keptChildCount === 1 ? 'row' : 'rows'} from this file
                  {keptChildCount === 1 ? ' belongs' : ' belong'} to a kept feature and will be imported too.
                </p>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? <ImportingLabel /> : 'Confirm Import'}
                </button>
              </div>
            </>
          )}

          {/* ── Done ───────────────────────────────────────────────────────── */}
          {step === 'done' && result && (
            <>
              <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
                Import complete
              </Dialog.Title>

              <table className="w-full text-sm mb-2">
                <tbody className="divide-y divide-gray-100">
                  <ResultRow label="Features created" value={result.created_features} />
                  <ResultRow label="Stories created" value={result.created_stories} />
                  {result.updated_features > 0 && (
                    <ResultRow label="Features updated" value={result.updated_features} />
                  )}
                  {result.updated_stories > 0 && (
                    <ResultRow label="Stories updated" value={result.updated_stories} />
                  )}
                  {result.removed_features > 0 && (
                    <ResultRow label="Features removed" value={result.removed_features} />
                  )}
                  {result.removed_stories > 0 && (
                    <ResultRow label="Stories removed" value={result.removed_stories} />
                  )}
                </tbody>
              </table>

              {(result.items_retyped ?? 0) > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {result.items_retyped} {result.items_retyped === 1 ? 'story' : 'stories'} converted
                  to {result.items_retyped === 1 ? 'a feature' : 'features'}
                </p>
              )}

              {(result.items_retype_skipped ?? 0) > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {result.items_retype_skipped}{' '}
                  {result.items_retype_skipped === 1 ? 'story is' : 'stories are'} a feature in the
                  file — left as {result.items_retype_skipped === 1 ? 'a story' : 'stories'}
                </p>
              )}

              {(result.items_retype_blocked ?? 0) > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {result.items_retype_blocked}{' '}
                  {result.items_retype_blocked === 1 ? 'feature is' : 'features are'} a story in the
                  file — features are never converted automatically
                </p>
              )}

              {(result.stories_reparented ?? 0) > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {result.stories_reparented}{' '}
                  {result.stories_reparented === 1 ? 'story' : 'stories'} moved to the feature the
                  file names
                </p>
              )}

              {(result.stories_reparent_skipped ?? 0) > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {result.stories_reparent_skipped}{' '}
                  {result.stories_reparent_skipped === 1 ? 'story sits' : 'stories sit'} under a
                  different feature than the file says — left as {result.stories_reparent_skipped === 1 ? 'it is' : 'they are'}
                </p>
              )}

              {(result.stories_parented_from_project ?? 0) > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {result.stories_parented_from_project}{' '}
                  {result.stories_parented_from_project === 1 ? 'story' : 'stories'} linked to a
                  feature already in the project, not listed in this file
                </p>
              )}

              {(result.orphan_stories_placed ?? 0) > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {result.orphan_stories_placed} orphan {result.orphan_stories_placed === 1 ? 'story' : 'stories'} placed in &quot;Unassigned&quot; feature
                </p>
              )}

              {/* Orphan rows matching an item already in the project are updated where
                  they sit — naming that feature keeps the summary honest, especially
                  when it is on the PI board and so invisible from the backlog. */}
              {(result.orphan_stories_existing ?? []).map((loc, i) => (
                <p key={`${loc.feature_title}-${i}`} className="text-xs text-gray-500 mt-2">
                  {loc.count} orphan {loc.count === 1 ? 'story' : 'stories'} already{' '}
                  {loc.count === 1 ? 'exists' : 'exist'} under &quot;{loc.feature_title}&quot; —{' '}
                  {loc.location === 'backlog'
                    ? 'left in the backlog'
                    : 'on the PI board, not the backlog'}
                </p>
              ))}

              <div className="flex justify-end mt-6">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                >
                  Close
                </button>
              </div>
            </>
          )}

          {/* ── Error ──────────────────────────────────────────────────────── */}
          {step === 'error' && (
            <>
              <Dialog.Title className="text-base font-semibold text-red-700 mb-4">
                Import failed
              </Dialog.Title>

              {serverErrors.length > 0 ? (
                <ErrorList errors={serverErrors} />
              ) : (
                <p className="text-sm text-gray-600">An unexpected error occurred. Please try again.</p>
              )}

              <div className="flex justify-end mt-6">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </>
          )}

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
