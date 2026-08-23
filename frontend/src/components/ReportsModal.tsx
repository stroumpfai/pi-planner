import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { downloadPIReport, DEFAULT_REPORT_OPTIONS } from '@/services/pis'
import type { ReportOptions, ReportType, ReportFormat } from '@/services/pis'
import { toast } from '@/stores/toastStore'

const STORAGE_KEY = 'pi-export-report-options'

function loadOptions(): ReportOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_REPORT_OPTIONS, ...JSON.parse(raw) }
  } catch {
    // ignore malformed storage
  }
  return { ...DEFAULT_REPORT_OPTIONS }
}

function saveOptions(opts: ReportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts))
  } catch {
    // ignore storage errors
  }
}

interface ToggleRowProps {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onChange: (value: boolean) => void
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-gray-800 dark:text-gray-100 cursor-pointer">
          {label}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-0.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
      </label>
    </div>
  )
}

interface CardOptionProps {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onSelect: () => void
}

function CardOption({ id, name, label, description, checked, onSelect }: CardOptionProps) {
  return (
    <label
      htmlFor={id}
      className={`flex-1 cursor-pointer rounded-md border p-2.5 transition-colors ${
        checked
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={onSelect}
          className="accent-blue-600"
        />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">{description}</p>
    </label>
  )
}

interface Props {
  readonly piId: string
  readonly piName: string
  readonly open: boolean
  readonly onClose: () => void
}

export function ReportsModal({ piId, piName, open, onClose }: Props) {
  const [opts, setOpts] = useState<ReportOptions>(loadOptions)
  const [exporting, setExporting] = useState(false)

  function setReportType(reportType: ReportType) {
    setOpts((prev) => ({ ...prev, reportType }))
  }

  function setFormat(format: ReportFormat) {
    setOpts((prev) => ({ ...prev, format }))
  }

  function handleClose() {
    setOpts(loadOptions())
    onClose()
  }

  async function handleExport() {
    saveOptions(opts)
    setExporting(true)
    try {
      await downloadPIReport(piId, piName, opts)
      onClose()
    } catch {
      toast.error('Report export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-[440px] max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Export report
          </Dialog.Title>
          <Dialog.Description className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Generate a management report for this PI. Settings are saved for next time.
          </Dialog.Description>

          <fieldset className="mb-3">
            <legend className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2">Report</legend>
            <div className="flex flex-col gap-2">
              <CardOption
                id="report-type-readiness"
                name="report-type"
                label="Readiness"
                description="Data-quality checks: unestimated, over-capacity, unplaced…"
                checked={opts.reportType === 'readiness'}
                onSelect={() => setReportType('readiness')}
              />
              <CardOption
                id="report-type-readout"
                name="report-type"
                label="Planning readout"
                description="Summary: load per team, capacity, milestones"
                checked={opts.reportType === 'readout'}
                onSelect={() => setReportType('readout')}
              />
              <CardOption
                id="report-type-breakdown"
                name="report-type"
                label="Sprint breakdown"
                description="Tree of sprints → features → PBIs/bugs"
                checked={opts.reportType === 'breakdown'}
                onSelect={() => setReportType('breakdown')}
              />
            </div>
          </fieldset>

          <fieldset className="mb-2">
            <legend className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2">Format</legend>
            <div className="flex gap-2">
              <CardOption
                id="report-fmt-markdown"
                name="report-fmt"
                label="Markdown"
                description="Editable .md text"
                checked={opts.format === 'markdown'}
                onSelect={() => setFormat('markdown')}
              />
              <CardOption
                id="report-fmt-pdf"
                name="report-fmt"
                label="PDF"
                description="Formatted document"
                checked={opts.format === 'pdf'}
                onSelect={() => setFormat('pdf')}
              />
            </div>
          </fieldset>

          <div>
            <ToggleRow
              id="report-show-ids"
              label="Display IDs"
              description="Prefix each item with its [ID]"
              checked={opts.showIds}
              onChange={(v) => setOpts((prev) => ({ ...prev, showIds: v }))}
            />
            {opts.reportType === 'breakdown' && (
              <>
                <ToggleRow
                  id="report-show-states"
                  label="Display states"
                  description="Show each item's State"
                  checked={opts.showStates}
                  onChange={(v) => setOpts((prev) => ({ ...prev, showStates: v }))}
                />
                <ToggleRow
                  id="report-include-unplaced"
                  label="Include unplaced items"
                  description="List PBIs and features not placed in a sprint"
                  checked={opts.includeUnplaced}
                  onChange={(v) => setOpts((prev) => ({ ...prev, includeUnplaced: v }))}
                />
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
