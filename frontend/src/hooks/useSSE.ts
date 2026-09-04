import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateAllProjectData } from './useSnapshots'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'

type SSEEvent = {
  type: string
  data?: Record<string, unknown>
}

/** Subscribe to one SSE channel, dispatching each event to *onEvent*. */
function useEventStream(url: string | null, onEvent: (event: SSEEvent) => void) {
  const esRef = useRef<EventSource | null>(null)
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    if (!url) return

    const es = new EventSource(url, { withCredentials: true })
    esRef.current = es

    es.onmessage = (e) => {
      try {
        handlerRef.current(JSON.parse(e.data as string) as SSEEvent)
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      // Browser EventSource auto-reconnects; no manual retry needed
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [url])
}

export function useSSE(projectId: string | null) {
  const qc = useQueryClient()
  useEventStream(
    projectId ? `/api/v1/projects/${projectId}/events` : null,
    (event) => handleSSEEvent(event, projectId as string, qc),
  )
}

/** Live team updates.
 *
 * Team data is its own aggregate on its own channel: it is edited without the
 * project lock and changes nothing a project can see until someone pushes
 * (teams.md §4). Readers watch it here the same way they watch a board.
 */
export function useTeamSSE(teamId: string | null) {
  const qc = useQueryClient()
  useEventStream(
    teamId ? `/api/v1/teams/${teamId}/events` : null,
    (event) => handleTeamSSEEvent(event, teamId as string, qc),
  )
}

function handleTeamSSEEvent(
  event: SSEEvent,
  teamId: string,
  qc: ReturnType<typeof useQueryClient>,
) {
  // Every team event refetches the team's own data. The channel carries nothing
  // else, so naming each type would buy nothing the prefix does not already say.
  if (!event.type.startsWith('team:') && !event.type.startsWith('member:')) return
  qc.invalidateQueries({ queryKey: ['teams'] })
  qc.invalidateQueries({ queryKey: ['team', teamId] })
  // Members are cached per as-of date, so the prefix invalidates every date the
  // views are holding rather than only today's.
  qc.invalidateQueries({ queryKey: ['teamMembers', teamId] })
  qc.invalidateQueries({ queryKey: ['patternVersions', teamId] })
  qc.invalidateQueries({ queryKey: ['teamProjects', teamId] })
  // Absences are cached per window, so the prefix reaches every span on screen.
  qc.invalidateQueries({ queryKey: ['absences', teamId] })
  // Meetings likewise: the matrix's window is whichever sprint is selected.
  qc.invalidateQueries({ queryKey: ['meetings', teamId] })
  // Capacity is computed on read from all of the above, so every team event
  // moves it — including one that changed no member at all, like a share.
  qc.invalidateQueries({ queryKey: ['teamCapacity', teamId] })
}

function handleSSEEvent(
  event: SSEEvent,
  projectId: string,
  qc: ReturnType<typeof useQueryClient>,
) {
  switch (event.type) {
    // ── Features ──────────────────────────────────────────────────────────
    case 'feature:created':
    case 'feature:updated':
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
      break

    case 'feature:deleted':
    case 'feature:moved':
    case 'features:cleared':
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
      break

    case 'backlog:cleared':
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      break

    // ── PBIs ──────────────────────────────────────────────────────────────
    case 'pbi:created':
    case 'pbi:updated':
    case 'pbi:deleted':
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      break

    // ── Groups ────────────────────────────────────────────────────────────
    case 'group:created':
    case 'group:updated':
    case 'group:deleted':
    case 'group:moved':
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'groups' })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['sprints'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
      break

    // ── PIs ───────────────────────────────────────────────────────────────
    case 'pi:created':
    case 'pi:updated':
    case 'pi:state_changed':
    case 'pi:deleted':
      qc.invalidateQueries({ queryKey: ['pis', projectId] })
      break

    // ── Swimlines ─────────────────────────────────────────────────────────
    case 'swimline:created':
    case 'swimline:updated':
    case 'swimline:deleted':
    case 'swimline:reordered':
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'swimlines' })
      break

    // ── Sprints ───────────────────────────────────────────────────────────
    case 'sprint:capacity_changed':
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'sprints' })
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'swimlines' })
      qc.invalidateQueries({ queryKey: ['pis'] })
      break

    // ── Projects ──────────────────────────────────────────────────────────
    case 'project:updated':
    case 'project:deleted':
      qc.invalidateQueries({ queryKey: ['projects'] })
      break

    case 'project:restored':
      invalidateAllProjectData(qc, projectId)
      toast.info('Project restored from a snapshot')
      break

    // An import is one transaction and arrives as one event, so everything it
    // could have touched is refetched rather than reasoned about per item.
    case 'import:completed': {
      invalidateAllProjectData(qc, projectId)
      const actor = typeof event.data?.actor === 'string' ? event.data.actor : ''
      // The importer's own client already refetched on the mutation succeeding;
      // telling them what they just did would be noise.
      if (actor !== '' && actor !== useAuthStore.getState().user?.username) {
        toast.info(`${actor} imported a CSV — the board has been refreshed`)
      }
      break
    }

    // ── States ────────────────────────────────────────────────────────────
    case 'state:created':
    case 'state:deleted':
    case 'state:reordered':
      qc.invalidateQueries({ queryKey: ['states', projectId] })
      break

    case 'state:updated':
      qc.invalidateQueries({ queryKey: ['states', projectId] })
      // A rename changes the value items display, without changing the items themselves.
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      break

    // ── Edit lock ─────────────────────────────────────────────────────────
    case 'edit-lock:acquired':
    case 'edit-lock:released':
      qc.invalidateQueries({ queryKey: ['editLock', projectId] })
      break

    default:
      break
  }
}
