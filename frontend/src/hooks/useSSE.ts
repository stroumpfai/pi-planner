import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

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
      // Browser auto-reconnects on error; no manual retry needed
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
    case 'feature:created':
    case 'feature:updated':
    case 'feature:deleted':
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      break
    case 'pbi:created':
    case 'pbi:updated':
    case 'pbi:deleted':
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      break
    case 'group:moved':
    case 'group:created':
    case 'group:deleted':
      // swimline queries are per-PI, but we don't have piId here;
      // invalidate all swimline/group queries for this project
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'groups' })
      break
    case 'edit-lock:acquired':
    case 'edit-lock:released':
      qc.invalidateQueries({ queryKey: ['editLock', projectId] })
      break
    default:
      break
  }
}
