import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Controller, useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdatePI } from '@/hooks/usePIs'
import { useSprints } from '@/hooks/useSprints'
import { sprintsApi } from '@/services/sprints'
import { DateInput } from './DateInput'
import type { PI, Sprint } from '@/types'

type PIFormValues = {
  name: string
  description?: string
  start_date: string
  end_date: string
}

type SprintRow = {
  system_id: string
  sprint_index: number
  capacity: string
  start_date: string
  end_date: string
}

interface Props {
  readonly open: boolean
  readonly pi: PI
  readonly projectId: string
  readonly onClose: () => void
}

function toSprintRow(s: Sprint): SprintRow {
  return {
    system_id: s.system_id,
    sprint_index: s.sprint_index ?? 0,
    capacity: String(s.capacity ?? 0),
    start_date: s.start_date ?? '',
    end_date: s.end_date ?? '',
  }
}

export function EditPIModal({ open, pi, projectId, onClose }: Props) {
  const updatePI = useUpdatePI(projectId)
  const { data: sprints } = useSprints(pi.system_id)
  const [sprintRows, setSprintRows] = useState<SprintRow[]>([])
  const qc = useQueryClient()

  // Sync sprint rows whenever the fetched sprints change or modal opens
  useEffect(() => {
    if (sprints) setSprintRows(sprints.map(toSprintRow))
  }, [sprints])

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } =
    useForm<PIFormValues>({
      defaultValues: {
        name: pi.name,
        description: pi.description ?? '',
        start_date: pi.start_date ?? '',
        end_date: pi.end_date ?? '',
      },
    })

  const handleClose = () => { reset(); onClose() }

  function updateSprintRow(index: number, field: keyof Omit<SprintRow, 'system_id' | 'sprint_index'>, value: string) {
    setSprintRows((rows) => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const onSubmit = async (values: PIFormValues) => {
    await updatePI.mutateAsync({
      piId: pi.system_id,
      body: {
        name: values.name,
        description: values.description || null,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      },
    })

    await Promise.all(
      sprintRows.map((row) =>
        sprintsApi.update(row.system_id, {
          capacity: Number.parseInt(row.capacity, 10) || 1,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
        })
      )
    )

    qc.invalidateQueries({ queryKey: ['sprints', pi.system_id] })
    qc.invalidateQueries({ queryKey: ['swimlines'] })
    qc.invalidateQueries({ queryKey: ['pis'] })

    onClose()
  }

  const inputClass = 'block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">Edit PI</Dialog.Title>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-5">
            {/* ── PI fields ── */}
            <div>
              <label htmlFor="pi-edit-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="pi-edit-name"
                {...register('name', { required: 'Name is required' })}
                autoFocus
                className={`mt-1 ${inputClass}`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="pi-edit-desc" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <textarea
                id="pi-edit-desc"
                {...register('description')}
                rows={2}
                className={`mt-1 ${inputClass}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pi-edit-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  PI start date
                </label>
                <Controller
                  name="start_date"
                  control={control}
                  render={({ field }) => (
                    <DateInput id="pi-edit-start" value={field.value} onChange={field.onChange} className={`mt-1 ${inputClass}`} />
                  )}
                />
              </div>
              <div>
                <label htmlFor="pi-edit-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  PI end date
                </label>
                <Controller
                  name="end_date"
                  control={control}
                  render={({ field }) => (
                    <DateInput id="pi-edit-end" value={field.value} onChange={field.onChange} className={`mt-1 ${inputClass}`} />
                  )}
                />
              </div>
            </div>

            {/* ── Sprint table ── */}
            {sprintRows.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sprints</h3>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left w-20">Sprint</th>
                        <th className="px-3 py-2 text-left w-24">Capacity</th>
                        <th className="px-3 py-2 text-left">Start date</th>
                        <th className="px-3 py-2 text-left">End date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {sprintRows.map((row, i) => (
                        <tr key={row.system_id}>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">
                            Sprint {row.sprint_index + 1}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              value={row.capacity}
                              onChange={(e) => updateSprintRow(i, 'capacity', e.target.value)}
                              className="w-20 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DateInput
                              id={`sprint-start-${i}`}
                              value={row.start_date}
                              onChange={(v) => updateSprintRow(i, 'start_date', v)}
                              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DateInput
                              id={`sprint-end-${i}`}
                              value={row.end_date}
                              onChange={(v) => updateSprintRow(i, 'end_date', v)}
                              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
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
