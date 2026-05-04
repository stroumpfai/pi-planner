import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import type { AxiosError } from 'axios'
import { useCreatePI } from '@/hooks/usePIs'

type FormValues = {
  name: string
  description?: string
  start_date?: string
  end_date?: string
}

interface Props {
  open: boolean
  projectId: string
  onClose: () => void
}

export function CreatePIModal({ open, projectId, onClose }: Props) {
  const createPI = useCreatePI(projectId)
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<FormValues>()

  const handleClose = () => { reset(); onClose() }

  const onSubmit = async (values: FormValues) => {
    try {
      await createPI.mutateAsync({
        name: values.name,
        description: values.description || null,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      })
      reset()
      onClose()
    } catch (err) {
      const detail = (err as AxiosError<{ detail?: { error?: string } }>)?.response?.data?.detail
      if (detail?.error === 'ACTIVE_PI_EXISTS') {
        setError('root', { message: 'Close the current In Progress PI before starting another.' })
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
          <Dialog.Title className="text-base font-semibold text-gray-900">New PI</Dialog.Title>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="pi-name" className="block text-sm font-medium text-gray-700">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="pi-name"
                {...register('name', { required: 'Name is required' })}
                autoFocus
                placeholder="e.g. Q2-2026 or PI-5"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="pi-desc" className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                id="pi-desc"
                {...register('description')}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pi-start" className="block text-sm font-medium text-gray-700">Start date</label>
                <input
                  id="pi-start"
                  type="date"
                  {...register('start_date')}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="pi-end" className="block text-sm font-medium text-gray-700">End date</label>
                <input
                  id="pi-end"
                  type="date"
                  {...register('end_date')}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            {errors.root && (
              <p className="text-xs text-red-600">{errors.root.message}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50">
                {isSubmitting ? 'Creating…' : 'Create PI'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
