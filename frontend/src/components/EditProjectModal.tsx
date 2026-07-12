import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useUpdateProject } from '@/hooks/useProjects'
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
})

type FormValues = z.infer<typeof schema>

interface Props {
  readonly open: boolean
  readonly project: Project
  readonly onClose: () => void
}

export function EditProjectModal({ open, project, onClose }: Props) {
  const updateProject = useUpdateProject(project.system_id)
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) reset({ name: project.name, description: project.description ?? '', azure_devops_url: project.azure_devops_url ?? '' })
  }, [open, project.name, project.description, project.azure_devops_url, reset])

  const onSubmit = async (values: FormValues) => {
    try {
      await updateProject.mutateAsync({
        name: values.name,
        description: values.description || null,
        azure_devops_url: values.azure_devops_url || null,
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
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
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
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="edit-proj-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                id="edit-proj-description"
                {...register('description')}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
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
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.azure_devops_url && <p className="mt-1 text-xs text-red-600">{errors.azure_devops_url.message}</p>}
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Link to the project in Azure DevOps, shown on the project card</p>
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
    </Dialog.Root>
  )
}
