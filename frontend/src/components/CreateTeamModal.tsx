import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateTeam } from '@/hooks/useTeams'
import { teamErrorCode } from '@/services/teams'
import { errorDetail } from '@/services/api'

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  normal_day_hours: z
    .number({ invalid_type_error: 'Hours per day is required' })
    .min(1, 'Must be between 1 and 24 hours')
    .max(24, 'Must be between 1 and 24 hours'),
})

type FormValues = z.infer<typeof schema>

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

export function CreateTeamModal({ open, onClose }: Props) {
  const create = useCreateTeam()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { normal_day_hours: 8 },
  })

  const close = () => {
    reset({ normal_day_hours: 8 })
    setFormError(null)
    onClose()
  }

  const onSubmit = async (values: FormValues) => {
    setFormError(null)
    try {
      await create.mutateAsync({
        name: values.name.trim(),
        description: values.description?.trim() || null,
        normal_day_hours: values.normal_day_hours,
      })
      close()
    } catch (err) {
      const code = teamErrorCode(err)
      if (code === 'TEAM_NAME_TAKEN') {
        setError('name', { message: 'A team with this name already exists' })
      } else if (code === 'TEAM_LIMIT_REACHED') {
        setFormError(errorDetail(err)?.message ?? 'This instance already holds the maximum number of teams.')
      } else {
        setFormError('Could not create the team — please try again.')
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">New Team</Dialog.Title>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="team-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="team-name"
                {...register('name')}
                autoFocus
                maxLength={100}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="e.g. Platform"
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="team-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                id="team-description"
                {...register('description')}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>

            <div>
              <label htmlFor="team-normal-day-hours" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Hours per day
              </label>
              <input
                id="team-normal-day-hours"
                type="number"
                // No native min/max/step: the browser would swallow the submit and show
                // its own bubble, leaving the zod range message unreachable — and a step
                // would reject day lengths the API accepts (any float in 1.0–24.0).
                step="any"
                {...register('normal_day_hours', { valueAsNumber: true })}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.normal_day_hours && <p className="mt-1 text-xs text-red-600">{errors.normal_day_hours.message}</p>}
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                The divisor that turns the team&rsquo;s hours into person-days. Not anyone&rsquo;s contracted day —
                those are set per member.
              </p>
            </div>

            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {isSubmitting ? 'Creating…' : 'Create Team'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
