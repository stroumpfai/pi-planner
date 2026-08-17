import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { snapshotsApi } from '@/services/snapshots'

const key = (projectId: string) => ['snapshots', projectId] as const

export const useSnapshots = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: () => snapshotsApi.list(projectId),
    enabled: !!projectId && enabled,
  })

export const useCreateSnapshot = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string }) => snapshotsApi.create(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useDeleteSnapshot = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) => snapshotsApi.delete(projectId, snapshotId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

/**
 * Invalidate every project-scoped query so the UI fully refetches after a
 * restore replaces all of the project's data (PIs, features, PBIs, swimlanes,
 * sprints, groups, the project itself, and the snapshot list).
 */
export function invalidateAllProjectData(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
): void {
  qc.invalidateQueries({ queryKey: ['projects'] })
  qc.invalidateQueries({ queryKey: ['features', projectId] })
  qc.invalidateQueries({ queryKey: ['pbis', projectId] })
  qc.invalidateQueries({ queryKey: ['pis', projectId] })
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'swimlines' })
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'groups' })
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'sprints' })
  qc.invalidateQueries({ queryKey: ['states', projectId] })
  qc.invalidateQueries({ queryKey: key(projectId) })
}

export const useRestoreSnapshot = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) => snapshotsApi.restore(projectId, snapshotId),
    onSuccess: () => invalidateAllProjectData(qc, projectId),
  })
}
