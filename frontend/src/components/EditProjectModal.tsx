import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useUpdateProject } from '@/hooks/useProjects'
import { ProjectStatesModal } from './ProjectStatesModal'
import { AZURE_DEVOPS_TEMPLATE, JIRA_TEMPLATE } from '@/utils/workItemUrl'
import type { AxiosError } from 'axios'
import type { Project } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(2000).optional(),
  azure_devops_url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .refine((v) => !v || /^https?:\/\/.+/i.test(v), 'Must be an http(s):// URL'),
  work_item_path_template: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((v) => !v || v.includes('{id}'), 'Must contain the {id} placeholder')
    .refine((v) => !v || (!v.includes('://') && !/\s/.test(v)), 'Must be a relative path with no spaces'),
  effort_unit: z.string().trim().max(20).optional(),
})

type FormValues = z.infer<typeof schema>

type LinkPreset = 'none' | 'azure_devops' | 'jira' | 'custom'

function presetFromTemplate(template: string | null | undefined): LinkPreset {
  if (!template) return 'none'
  if (template === AZURE_DEVOPS_TEMPLATE) return 'azure_devops'
  if (template === JIRA_TEMPLATE) return 'jira'
  return 'custom'
}

interface Props {
  readonly open: boolean
  readonly project: Project
  readonly onClose: () => void
}

export function EditProjectModal({ open, project, onClose }: Props) {
  const updateProject = useUpdateProject(project.system_id)
  const [linkPreset, setLinkPreset] = useState<LinkPreset>('none')
  const [showStates, setShowStates] = useState(false)
  const { register, handleSubmit, reset, setError, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) {
      reset({
        name: project.name,
        description: project.description ?? '',
        azure_devops_url: project.azure_devops_url ?? '',
        work_item_path_template: project.work_item_path_template ?? '',
        effort_unit: project.effort_unit ?? 'pts',
      })
      setLinkPreset(presetFromTemplate(project.work_item_path_template))
    }
  }, [open, project.name, project.description, project.azure_devops_url, project.work_item_path_template, project.effort_unit, reset])

  const handlePresetChange = (value: LinkPreset) => {
    setLinkPreset(value)
    if (value === 'azure_devops') setValue('work_item_path_template', AZURE_DEVOPS_TEMPLATE)
    else if (value === 'jira') setValue('work_item_path_template', JIRA_TEMPLATE)
    else if (value === 'none') setValue('work_item_path_template', '')
    // 'custom' keeps the current value so the user can edit it below.
  }

  const onSubmit = async (values: FormValues) => {
    try {
      await updateProject.mutateAsync({
        name: values.name,
        description: values.description || null,
        azure_devops_url: values.azure_devops_url || null,
        work_item_path_template: values.work_item_path_template || null,
        effort_unit: values.effort_unit?.trim() || 'pts',
      })
      onClose()
    } catch (err) {
      const status = (err as AxiosError)?.response?.status
      if (status === 409) {
        setError('name', { message: 'A project with this name already exists' })
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">Edit Project</Dialog.Title>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="edit-proj-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-proj-name"
                {...register('name')}
                autoFocus
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="edit-proj-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                id="edit-proj-description"
                {...register('description')}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>

            <div>
              <label htmlFor="edit-proj-azure-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Azure DevOps URL</label>
              <input
                id="edit-proj-azure-url"
                type="url"
                {...register('azure_devops_url')}
                placeholder="https://dev.azure.com/org/project"
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.azure_devops_url && <p className="mt-1 text-xs text-red-600">{errors.azure_devops_url.message}</p>}
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Link to the project in Azure DevOps, shown on the project card</p>
            </div>

            <div>
              <label htmlFor="effort-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Effort unit</label>
              <input
                id="effort-unit"
                {...register('effort_unit')}
                maxLength={20}
                placeholder="pts"
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.effort_unit && <p className="mt-1 text-xs text-red-600">{errors.effort_unit.message}</p>}
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Label shown next to effort and capacity values</p>
            </div>

            <div>
              <label htmlFor="edit-proj-link-preset" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Work-item links</label>
              <select
                id="edit-proj-link-preset"
                value={linkPreset}
                onChange={(e) => handlePresetChange(e.target.value as LinkPreset)}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="none">None (no per-item links)</option>
                <option value="azure_devops">Azure DevOps</option>
                <option value="jira">Jira</option>
                <option value="custom">Custom…</option>
              </select>
              {linkPreset === 'custom' && (
                <input
                  {...register('work_item_path_template')}
                  placeholder="_workitems/edit/{id}"
                  className="mt-2 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
                />
              )}
              {errors.work_item_path_template && <p className="mt-1 text-xs text-red-600">{errors.work_item_path_template.message}</p>}
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Builds a per-item link from the URL above + this path (with <code>{'{id}'}</code> as the item ID). Features and stories then show a link to open in the tracker.
              </p>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <p className="block text-sm font-medium text-gray-700 dark:text-gray-300">States</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                The labels the features, PBIs and bugs in this project can carry.
                Also populated by CSV import.
              </p>
              <button
                type="button"
                onClick={() => setShowStates(true)}
                className="mt-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Manage States…
              </button>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {isSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Nested, not a replacement: closing Edit Project here would discard its unsaved fields. */}
      <ProjectStatesModal
        open={showStates}
        projectId={project.system_id}
        onClose={() => setShowStates(false)}
      />
    </Dialog.Root>
  )
}
