import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Controller, useForm } from 'react-hook-form'
import type { AxiosError } from 'axios'
import type { PBI } from '@/types'
import { EFFORT_VALUES } from '@/constants/effort'
import { useStates } from '@/hooks/useStates'
import { useUiStore } from '@/stores/uiStore'
import { DateInput } from './DateInput'
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
  /**
   * ISO YYYY-MM-DD. Present only when the user edited the date on a done item —
   * otherwise omitted, so the server's own stamp on a State change stands.
   */
  completed_on?: string
}

/** Today in the browser's calendar, as ISO YYYY-MM-DD — a display prefill, never sent unedited. */
function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
  const seed = (): PBIFormValues =>
    pbi
      ? { title: pbi.title, description: pbi.description ?? undefined, effort: pbi.effort, id: pbi.id, item_type: pbi.item_type ?? 'story', state_id: pbi.state_id ?? null, completed_on: pbi.completed_on ?? '' }
      : { title: '', item_type: defaultType, state_id: null, completed_on: '' }
  const { register, control, handleSubmit, reset, setError, clearErrors, watch, setValue, formState: { errors, isSubmitting, isDirty } } =
    useForm<PBIFormValues>({ defaultValues: seed() })
  // Whether the user typed a date themselves. Only then is completed_on sent:
  // a prefilled "today" is the browser's calendar, and the server stamps its own.
  const [dateEdited, setDateEdited] = useState(false)
  // Bumped to remount DateInput when a blanked date snaps back to its value.
  const [dateInputKey, setDateInputKey] = useState(0)

  // Reseed the form each time the modal opens so it reflects the current PBI
  // (the shared modal in GroupCard swaps which PBI it edits without remounting).
  useEffect(() => {
    if (!open) return
    reset(seed())
    setDateEdited(false)
    // Keyed to pbi identity (not the object) so a background refetch while the
    // modal is open doesn't wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pbi?.system_id, defaultType, reset])

  // A newer copy of the same item — typically the refetch after a save, when the
  // modal was reopened before it landed — replaces the one the form was seeded
  // from, unless the user has started editing. Otherwise the form would show, and
  // a save would write back, the item as it was before.
  useEffect(() => {
    if (!open || isDirty) return
    reset(seed())
    setDateEdited(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbi?.modified_at])

  const itemType = watch('item_type')
  const effortValue = watch('effort')
  const stateId = watch('state_id')
  const completedOn = watch('completed_on') ?? ''

  // Same project resolution as StateSelect, so both read one cached State List.
  const activeProjectId = useUiStore((s) => s.activeProjectId)
  // Only while open: a closed modal sits mounted in every list row.
  const { data: allStates } = useStates(pbi?.project_id ?? activeProjectId ?? '', open)
  const states = (allStates ?? []).filter((s) => s.item_type === itemType)
  // Done-ness is the State's category, never its wording.
  const isDoneState = (id: string | null | undefined) =>
    !!id && states.find((s) => s.system_id === id)?.category === 'done'
  const isDone = isDoneState(stateId)
  // PBICreate carries no completed_on — the server stamps a new item created done —
  // so on create the field only previews that and stays disabled.
  const dateEnabled = isDone && isEdit && !readOnly
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
    changeState(null)
  }

  // The date follows the State: into done prefills, out of done clears. Neither is
  // a user edit, so neither is sent. Returning to the saved done State shows the
  // saved date, because the server keeps it (no not-done → done edge on save).
  const changeState = (next: string | null) => {
    setValue('state_id', next)
    setDateEdited(false)
    clearErrors('completed_on')
    if (!isDoneState(next)) {
      setValue('completed_on', '')
    } else if (!completedOn) {
      const savedDate = pbi && isDoneState(pbi.state_id) ? pbi.completed_on : null
      setValue('completed_on', savedDate ?? todayIso())
    }
  }

  const changeDate = (iso: string) => {
    if (!iso) {
      // The date can't be blanked while the item is done (leaving done clears it),
      // so an emptied field snaps back to what it held.
      setDateInputKey((k) => k + 1)
      return
    }
    if (iso === completedOn) return
    setValue('completed_on', iso)
    setDateEdited(true)
    clearErrors('completed_on')
  }

  const handleFormSubmit = async (values: PBIFormValues) => {
    try {
      const { completed_on: completedOnValue, ...rest } = values
      const sendDate = isEdit && dateEdited && isDoneState(values.state_id) && !!completedOnValue
      await onSubmit({
        ...rest,
        description: values.description || null,
        effort: values.effort ?? null,
        id: values.id || null,
        state_id: values.state_id ?? null,
        ...(sendDate ? { completed_on: completedOnValue } : {}),
      })
      reset()
      onClose()
    } catch (err) {
      const response = (err as AxiosError<{ error?: string; detail?: { error?: string } }>)?.response
      const status = response?.status
      const code = response?.data?.detail?.error ?? response?.data?.error
      if (status === 409 && code === 'ID_ALREADY_EXISTS') {
        setError('id', { message: `ID ${values.id} is already used in this project` })
      } else if (status === 422 && code === 'NOT_COMPLETED') {
        setError('completed_on', { message: 'Only a done item has a completion date' })
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

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="state_id"
                control={control}
                render={({ field }) => (
                  <StateSelect
                    itemType={itemType}
                    projectId={pbi?.project_id}
                    value={field.value ?? null}
                    onChange={changeState}
                    disabled={readOnly}
                  />
                )}
              />
              {/* A nested fieldset disables DateInput without it needing a prop. */}
              <fieldset disabled={!dateEnabled} className="min-w-0 border-0 p-0 m-0">
                <label htmlFor="pbi-completed-on" className="block text-sm font-medium text-gray-700">
                  Completed on
                </label>
                <DateInput
                  key={dateInputKey}
                  id="pbi-completed-on"
                  value={completedOn}
                  onChange={changeDate}
                  className={inputClass}
                />
                {errors.completed_on && (
                  <p className="mt-1 text-xs text-red-600">{errors.completed_on.message}</p>
                )}
              </fieldset>
            </div>
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
