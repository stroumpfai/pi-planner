import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { downloadPIPNG, DEFAULT_EXPORT_PNG_OPTIONS } from '@/services/pis'
import type { ExportPNGOptions, ExportPNGLayout } from '@/services/pis'
import { toast } from '@/stores/toastStore'

const STORAGE_KEY = 'pi-export-png-options'

function loadOptions(): ExportPNGOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_EXPORT_PNG_OPTIONS, ...JSON.parse(raw) }
  } catch {
    // ignore malformed storage
  }
  return { ...DEFAULT_EXPORT_PNG_OPTIONS }
}

function saveOptions(opts: ExportPNGOptions): void {
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

interface LayoutOptionProps {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onSelect: () => void
}

function LayoutOption({ id, label, description, checked, onSelect }: LayoutOptionProps) {
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
          name="export-layout"
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

export function ExportPNGModal({ piId, piName, open, onClose }: Props) {
  const [opts, setOpts] = useState<ExportPNGOptions>(loadOptions)
  const [exporting, setExporting] = useState(false)

  function toggle(key: 'showPiEffort' | 'showSprintEffort' | 'showSwimlaneEffort' | 'showEvents' | 'swimlaneTextCenter' | 'showExportDate' | 'splitBySwimline' | 'showId') {
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function setLayout(layout: ExportPNGLayout) {
    setOpts((prev) => ({ ...prev, layout }))
  }

  // Grid layouts (heatmap, composition) don't use the per-sprint / event toggles.
  const isGridLayout = opts.layout === 'heatmap' || opts.layout === 'composition'

  function handleClose() {
    setOpts(loadOptions())
    onClose()
  }

  async function handleExport() {
    saveOptions(opts)
    setExporting(true)
    try {
      await downloadPIPNG(piId, piName, opts)
      onClose()
    } catch {
      toast.error('PNG export failed')
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
            Export PNG
          </Dialog.Title>
          <Dialog.Description className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Choose what to include in the exported image. Settings are saved for next time.
          </Dialog.Description>

          <fieldset className="mb-2">
            <legend className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2">Layout</legend>
            <div className="grid grid-cols-2 gap-2">
              <LayoutOption
                id="export-layout-roadmap"
                label="Roadmap bars"
                description="Swimlanes as horizontal bars"
                checked={opts.layout === 'roadmap'}
                onSelect={() => setLayout('roadmap')}
              />
              <LayoutOption
                id="export-layout-list"
                label="PBI list"
                description="Sprint columns list their PBIs"
                checked={opts.layout === 'list'}
                onSelect={() => setLayout('list')}
              />
              <LayoutOption
                id="export-layout-heatmap"
                label="Heatmap"
                description="Team × sprint capacity grid"
                checked={opts.layout === 'heatmap'}
                onSelect={() => setLayout('heatmap')}
              />
              <LayoutOption
                id="export-layout-composition"
                label="Composition"
                description="PBI & bug counts per team × sprint"
                checked={opts.layout === 'composition'}
                onSelect={() => setLayout('composition')}
              />
            </div>
          </fieldset>

          <div>
            <ToggleRow
              id="export-pi-effort"
              label="PI effort"
              description="Show total effort and capacity in the PI title bar"
              checked={opts.showPiEffort}
              onChange={() => toggle('showPiEffort')}
            />
            {!isGridLayout && (
              <ToggleRow
                id="export-sprint-effort"
                label="Sprint effort"
                description="Show effort, capacity and ratio bar in each sprint header"
                checked={opts.showSprintEffort}
                onChange={() => toggle('showSprintEffort')}
              />
            )}
            {!isGridLayout && (
              <ToggleRow
                id="export-events"
                label="Events"
                description="Show PI events as vertical markers on the chart"
                checked={opts.showEvents}
                onChange={() => toggle('showEvents')}
              />
            )}
            <ToggleRow
              id="export-date"
              label="Export date"
              description="Show the date of generation in the bottom-right corner"
              checked={opts.showExportDate}
              onChange={() => toggle('showExportDate')}
            />
            {opts.layout === 'roadmap' && (
              <ToggleRow
                id="export-swimlane-effort"
                label="Swimlane effort"
                description="Show effort value inside each swimlane bar"
                checked={opts.showSwimlaneEffort}
                onChange={() => toggle('showSwimlaneEffort')}
              />
            )}
            {opts.layout === 'roadmap' && (
              <ToggleRow
                id="export-swimlane-center"
                label="Center swimlane text"
                description="Center swimlane labels inside bars (default: left-aligned)"
                checked={opts.swimlaneTextCenter}
                onChange={() => toggle('swimlaneTextCenter')}
              />
            )}
            {opts.layout === 'list' && (
              <ToggleRow
                id="export-split-swimline"
                label="Split by swimline"
                description="Group each sprint's PBIs under their swimline"
                checked={opts.splitBySwimline}
                onChange={() => toggle('splitBySwimline')}
              />
            )}
            {opts.layout === 'list' && (
              <ToggleRow
                id="export-show-id"
                label="Display the ID"
                description="Prefix each PBI with its [ID]"
                checked={opts.showId}
                onChange={() => toggle('showId')}
              />
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
