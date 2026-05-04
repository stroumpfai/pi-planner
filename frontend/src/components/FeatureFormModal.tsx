import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import type { AxiosError } from 'axios'
import type { Feature } from '@/types'

export type FeatureFormValues = {
  title: string
  description?: string | null
  effort?: number | null
  id?: number | null
}

interface Props {
  open: boolean
  feature?: Feature
  onClose: () => void
  onSubmit: (values: FeatureFormValues) => Promise<unknown>
}

export function FeatureFormModal({ open, feature, onClose, onSubmit }: Props) {
  const isEdit = !!feature
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FeatureFormValues>({
    defaultValues: feature
      ? { title: feature.title, description: feature.description ?? undefined, effort: feature.effort, id: feature.id }
      : {},
  })

  const handleClose = () => { reset(); onClose() }

  const handleFormSubmit = async (values: FeatureFormValues) => {
    try {
      await onSubmit({
        ...values,
        description: values.description || null,
        effort: values.effort || null,
        id: values.id || null,
      })
      reset()
      onClose()
    } catch (err) {
      const status = (err as AxiosError)?.response?.status
      const detail = (err as AxiosError<{ detail?: { error?: string } }>)?.response?.data?.detail
      if (status === 409 && detail?.error === 'ID_ALREADY_EXISTS') {
        setError('id', { message: `ID ${values.id} is already used in this project` })
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Feature' : 'New Feature'}
          </Dialog.Title>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="feat-title" className="block text-sm font-medium text-gray-700">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="feat-title"
                {...register('title')}
                autoFocus
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
            </div>

            <div>
              <label htmlFor="feat-desc" className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                id="feat-desc"
                {...register('description')}
                rows={3}
                maxLength={2000}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="feat-effort" className="block text-sm font-medium text-gray-700">
                  Effort <span className="text-gray-400 font-normal">(pts)</span>
                </label>
                <input
                  id="feat-effort"
                  type="number"
                  min={1}
                  {...register('effort', { valueAsNumber: true })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder="e.g. 13"
                />
              </div>
              <div>
                <label htmlFor="feat-id" className="block text-sm font-medium text-gray-700">
                  ID <span className="text-gray-400 font-normal">(1–999999)</span>
                </label>
                <input
                  id="feat-id"
                  type="number"
                  min={1}
                  max={999999}
                  {...register('id', { valueAsNumber: true })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder="optional"
                />
                {errors.id && <p className="mt-1 text-xs text-red-600">{errors.id.message}</p>}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Feature'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
