import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/projects'
import type { ProjectCreate, ProjectUpdate } from '@/types'

const PROJECTS_KEY = ['projects'] as const

export const useProjects = () =>
  useQuery({ queryKey: PROJECTS_KEY, queryFn: projectsApi.list })

export const useProject = (projectId: string) =>
  useQuery({
    queryKey: [...PROJECTS_KEY, projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

export const useCreateProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectCreate) => projectsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export const useUpdateProject = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectUpdate) => projectsApi.update(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export const useDeleteProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}
