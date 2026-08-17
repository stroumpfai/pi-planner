import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AxiosError } from 'axios'
import { parseImportCSV, buildPreview } from '@/utils/csvParser'
import type { ImportPreview, ParsedRow, ParseResult } from '@/utils/csvParser'
import { useCsvImport } from '@/hooks/useCsvImport'
import type { CsvImportResult, Feature, PBI } from '@/types'

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly file: File | null
  readonly features: readonly Feature[]
  readonly pbis: readonly PBI[]
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
}

function parsedRowToCsvRow(r: ParsedRow) {
  return {
    row_number: r.rowNumber,
    item_type: r.itemType,
    user_id: r.userId,
    title: r.title,
    effort: r.effort,
    parent_id: r.parentId,
  }
}

/** Match Removed rows (by ID) against items already in the project. */
function computeCandidates(
  removedItems: ParsedRow[],
  features: readonly Feature[],
  pbis: readonly PBI[],
): RemovalCandidate[] {
  const featureById = new Map<number, Feature>()
  for (const f of features) if (f.id != null) featureById.set(f.id, f)
  const pbiById = new Map<number, PBI>()
  for (const p of pbis) if (p.id != null) pbiById.set(p.id, p)

  const candidates: RemovalCandidate[] = []
  const seen = new Set<number>()
  for (const item of removedItems) {
    if (item.userId === null || seen.has(item.userId)) continue
    const feature = featureById.get(item.userId)
    if (feature) {
      candidates.push({ userId: item.userId, title: feature.title, systemId: feature.system_id, isFeature: true, parentSystemId: null })
      seen.add(item.userId)
      continue
    }
    const pbi = pbiById.get(item.userId)
    if (pbi) {
      candidates.push({ userId: item.userId, title: pbi.title, systemId: pbi.system_id, isFeature: false, parentSystemId: pbi.parent_feature_system_id })
      seen.add(item.userId)
    }
  }
  // Features first, then stories
  return candidates.sort((a, b) => Number(b.isFeature) - Number(a.isFeature))
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
              ↳ {preview.orphanCount} orphan {preview.orphanCount === 1 ? 'story' : 'stories'} — will be placed in &quot;Unassigned&quot; feature
            </td>
            <td />
          </tr>
        )}
      </tbody>
    </table>
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
                {isForced && ' — removed with its parent feature'}
              </p>
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

export function ImportCSVModal({ open, projectId, file, features, pbis, onClose }: Props) {
  const [step, setStep] = useState<Step>('preview')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [candidates, setCandidates] = useState<RemovalCandidate[]>([])
  const [removeSelection, setRemoveSelection] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const [serverErrors, setServerErrors] = useState<ServerError[]>([])

  const importMutation = useCsvImport(projectId)

  // Parse the file whenever a new one is selected and the modal opens
  useEffect(() => {
    if (!open || !file) return
    setStep('preview')
    setPreview(null)
    setParsedRows([])
    setCandidates([])
    setRemoveSelection(new Set())
    setResult(null)
    setServerErrors([])

    file.text().then((text) => {
      const parseResult: ParseResult = parseImportCSV(text)
      setParsedRows(parseResult.rows)
      setPreview(buildPreview(parseResult))
      setCandidates(computeCandidates(parseResult.removedItems, features, pbis))
    })
  }, [open, file, features, pbis])

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
        rows: parsedRows.map(parsedRowToCsvRow),
        removals,
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
    setParsedRows([])
    setCandidates([])
    setRemoveSelection(new Set())
    setResult(null)
    setServerErrors([])
    onClose()
  }

  const removeCount = new Set([...removeSelection, ...forced]).size

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        >

          {/* ── Preview ────────────────────────────────────────────────────── */}
          {step === 'preview' && (
            <>
              <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
                Import CSV
              </Dialog.Title>

              {preview === null ? (
                <p className="text-sm text-gray-400">Parsing file…</p>
              ) : (
                <>
                  <PreviewTable preview={preview} />

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
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={preview === null || preview.hasErrors}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {candidates.length > 0 ? 'Next' : 'Confirm Import'}
                </button>
              </div>
            </>
          )}

          {/* ── Reconcile ──────────────────────────────────────────────────── */}
          {(step === 'reconcile' || step === 'importing') && (
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
                  {removeCount} {removeCount === 1 ? 'item' : 'items'} will be deleted permanently — this cannot be undone. Removing a feature also deletes its stories.
                </p>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  disabled={step === 'importing'}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={step === 'importing'}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === 'importing' ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}Importing…
                    </span>
                  ) : 'Confirm Import'}
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

              {result.orphan_stories > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {result.orphan_stories} orphan {result.orphan_stories === 1 ? 'story' : 'stories'} placed in &quot;Unassigned&quot; feature
                </p>
              )}

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
