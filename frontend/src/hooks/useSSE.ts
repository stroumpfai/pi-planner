import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateAllProjectData } from './useSnapshots'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'

type SSEEvent = {
  type: string
  data?: Record<string, unknown>
}

export function useSSE(projectId: string | null) {
  const qc = useQueryClient()
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!projectId) return

    const es = new EventSource(`/api/v1/projects/${projectId}/events`, {
      withCredentials: true,
    })
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data as string)
        handleSSEEvent(event, projectId, qc)
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
  }, [projectId, qc])
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
