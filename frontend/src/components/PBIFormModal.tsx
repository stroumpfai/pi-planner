import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Controller, useForm } from 'react-hook-form'
import type { AxiosError } from 'axios'
import type { PBI } from '@/types'
import { EFFORT_VALUES } from '@/constants/effort'
import { StateSelect } from './StateSelect'
import { WorkItemLink } from './WorkItemLink'

export type PBIFormValues = {
  title: string
  description?: string | null
  effort?: number | null
  id?: number | null
  item_type: 'story' | 'bug'
  /** An entry in the State List matching item_type; null means no State. */
  state_id?: string | null
}

interface Props {
  readonly open: boolean
  readonly pbi?: PBI
  readonly defaultType?: 'story' | 'bug'
  readonly readOnly?: boolean
  readonly onClose: () => void
  readonly onSubmit: (values: PBIFormValues) => Promise<unknown>
}

export function PBIFormModal({ open, pbi, defaultType = 'story', readOnly = false, onClose, onSubmit }: Props) {
  const isEdit = !!pbi
  const { register, control, handleSubmit, reset, setError, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<PBIFormValues>({
      defaultValues: pbi
        ? { title: pbi.title, description: pbi.description ?? undefined, effort: pbi.effort, id: pbi.id, item_type: pbi.item_type ?? 'story', state_id: pbi.state_id ?? null }
        : { item_type: defaultType, state_id: null },
    })

  // Reseed the form each time the modal opens so it reflects the current PBI
  // (the shared modal in GroupCard swaps which PBI it edits without remounting).
  useEffect(() => {
    if (!open) return
    reset(
      pbi
        ? { title: pbi.title, description: pbi.description ?? undefined, effort: pbi.effort, id: pbi.id, item_type: pbi.item_type ?? 'story', state_id: pbi.state_id ?? null }
        : { item_type: defaultType, state_id: null },
    )
    // Keyed to pbi identity (not the object) so a background refetch while the
    // modal is open doesn't wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pbi?.system_id, defaultType, reset])

  const itemType = watch('item_type')
  const effortValue = watch('effort')
  const typeLabel = itemType === 'bug' ? 'Bug' : 'PBI'
  const actionLabel = isEdit ? 'Save Changes' : `Create ${typeLabel}`
  let dialogTitle = 'New story'
  if (readOnly) dialogTitle = `${typeLabel} details`
  else if (isEdit) dialogTitle = `Edit ${typeLabel}`

  const handleClose = () => { reset(); onClose() }

  // Stories and Bugs draw from separate State Lists, so switching type strands the
  // current State — clear it rather than carry a value the new list doesn't have.
  const switchType = (next: 'story' | 'bug') => {
    if (next === itemType) return
    setValue('item_type', next)
    setValue('state_id', null)
  }

  const handleFormSubmit = async (values: PBIFormValues) => {
    try {
      await onSubmit({
        ...values,
        description: values.description || null,
        effort: values.effort ?? null,
        id: values.id || null,
        state_id: values.state_id ?? null,
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

  const inputClass = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-gray-900">
            {dialogTitle}
            {readOnly && (
              <span className="text-xs font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                Read-only
              </span>
            )}
          </Dialog.Title>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="mt-4 space-y-4">
            <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0 space-y-4 disabled:opacity-70">
            {/* Type toggle */}
            <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => switchType('story')}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  itemType === 'story'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                PBI
              </button>
              <button
                type="button"
                onClick={() => switchType('bug')}
                className={`px-4 py-1.5 text-sm font-medium border-l border-gray-300 transition-colors ${
                  itemType === 'bug'
                    ? 'bg-red-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Bug
              </button>
            </div>

            <div>
              <label htmlFor="pbi-title" className="block text-sm font-medium text-gray-700">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="pbi-title"
                {...register('title', { required: 'Title is required' })}
                autoFocus
                className={inputClass}
              />
              {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
            </div>

            <div>
              <label htmlFor="pbi-desc" className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                id="pbi-desc"
                {...register('description')}
                rows={3}
                maxLength={2000}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="block text-sm font-medium text-gray-700">
                  Effort <span className="text-gray-400 font-normal">(pts)</span>
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <button
                    type="button"
                    onClick={() => setValue('effort', null)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      effortValue == null
                        ? 'bg-gray-600 text-white border-gray-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    —
                  </button>
                  {EFFORT_VALUES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setValue('effort', v)}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        effortValue === v
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {v === 0.5 ? '½' : v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="pbi-id" className="block text-sm font-medium text-gray-700">
                  ID <span className="text-gray-400 font-normal">(1–999999)</span>
                </label>
                <input
                  id="pbi-id"
                  type="number"
                  min={1}
                  max={999999}
                  {...register('id', { valueAsNumber: true })}
                  className={inputClass}
                  placeholder="optional"
                />
                {errors.id && <p className="mt-1 text-xs text-red-600">{errors.id.message}</p>}
              </div>
            </div>

            <Controller
              name="state_id"
              control={control}
              render={({ field }) => (
                <StateSelect
                  itemType={itemType}
                  projectId={pbi?.project_id}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  disabled={readOnly}
                />
              )}
            />
            </fieldset>

            {pbi && (
              <WorkItemLink projectId={pbi.project_id} id={pbi.id} variant="inline" label="Work item" />
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {readOnly ? 'Close' : 'Cancel'}
              </button>
              {!readOnly && (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving…' : actionLabel}
                </button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
