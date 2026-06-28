import { usePIEvents } from '@/hooks/usePIEvents'
import { useSettingsStore } from '@/stores/settingsStore'
import { EVENT_TYPE_CONFIG, groupEventsBySprint } from '@/utils/piEvents'
import { fmtDate } from '@/utils/dates'
import type { PIEvent, Sprint } from '@/types'

interface Props {
  readonly piId: string
  readonly sprints: Sprint[]
  readonly canEdit: boolean
  readonly onAdd: () => void
  readonly onEdit: (event: PIEvent) => void
}

export function PIEventsRow({ piId, sprints, canEdit, onAdd, onEdit }: Props) {
  const showPIEvents = useSettingsStore((s) => s.showPIEvents)
  const { data: events = [] } = usePIEvents(piId)

  if (!showPIEvents) return null

  const bySprintIndex = groupEventsBySprint(events, sprints)

  return (
    <div className="flex border-b border-white/50 dark:border-white/5 bg-canvas/80 flex-shrink-0">
      {/* Left header cell — matches the feature column */}
      <div
        className="flex-shrink-0 border-r border-white/50 dark:border-white/5 px-3 py-1.5 flex items-center justify-between gap-1 min-h-[32px]"
        style={{ width: 'var(--feature-col-width, 192px)' }}
      >
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Events</span>
        {canEdit && (
          <button
            type="button"
            onClick={onAdd}
            title="Add event"
            className="text-xs text-gray-400 hover:text-blue-500 leading-none px-1"
          >
            +
          </button>
        )}
      </div>

      {/* Per-sprint event cells */}
      {sprints.map((sprint) => {
        const sprintEvents = bySprintIndex.get(sprint.sprint_index ?? 0) ?? []
        return (
          <div
            key={sprint.system_id}
            className="flex-1 border-r border-white/50 dark:border-white/5 last:border-r-0 px-1.5 py-1 flex flex-wrap gap-1 min-h-[32px] items-start content-start"
          >
            {sprintEvents.map((ev) => {
              const cfg = EVENT_TYPE_CONFIG[ev.event_type]
              return (
                <button
                  key={ev.system_id}
                  type="button"
                  onClick={canEdit ? () => onEdit(ev) : undefined}
                  title={`${cfg.label}: ${ev.name} — ${fmtDate(ev.event_date)}`}
                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium leading-tight ${cfg.colorClass} ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                >
                  <span>{cfg.icon}</span>
                  <span className="truncate max-w-[10rem]">{ev.name}</span>
                  <span className="opacity-60 whitespace-nowrap">{fmtDate(ev.event_date)}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
