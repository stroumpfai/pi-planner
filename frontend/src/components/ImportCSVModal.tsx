import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AxiosError } from 'axios'
import { parseImportCSV, buildPreview } from '@/utils/csvParser'
import type { ImportPreview, ParsedRow } from '@/utils/csvParser'
import { useCsvImport } from '@/hooks/useCsvImport'
import type { CsvImportResult } from '@/types'

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly file: File | null
  readonly onClose: () => void
}

type Step = 'preview' | 'importing' | 'done' | 'error'

interface ServerError {
  row: number
  message: string
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

// ── Main modal ────────────────────────────────────────────────────────────────

export function ImportCSVModal({ open, projectId, file, onClose }: Props) {
  const [step, setStep] = useState<Step>('preview')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const [serverErrors, setServerErrors] = useState<ServerError[]>([])

  const importMutation = useCsvImport(projectId)

  // Parse the file whenever a new one is selected and the modal opens
  useEffect(() => {
    if (!open || !file) return
    setStep('preview')
    setPreview(null)
    setParsedRows([])
    setResult(null)
    setServerErrors([])

    file.text().then((text) => {
      const parseResult = parseImportCSV(text)
      setParsedRows(parseResult.rows)
      setPreview(buildPreview(parseResult))
    })
  }, [open, file])

  async function handleConfirm() {
    setStep('importing')
    try {
      const res = await importMutation.mutateAsync({
        rows: parsedRows.map(parsedRowToCsvRow),
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

  function handleClose() {
    setStep('preview')
    setPreview(null)
    setParsedRows([])
    setResult(null)
    setServerErrors([])
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        >

          {/* ── Preview ────────────────────────────────────────────────────── */}
          {(step === 'preview' || step === 'importing') && (
            <>
              <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
                Import CSV
              </Dialog.Title>

              {preview === null ? (
                <p className="text-sm text-gray-400">Parsing file…</p>
              ) : (
                <>
                  <PreviewTable preview={preview} />

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
                  disabled={preview === null || preview.hasErrors || step === 'importing'}
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
