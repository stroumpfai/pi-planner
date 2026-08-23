import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { usersApi } from '@/services/users'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { isAppNamePassword, isCommonPassword } from '@/utils/passwordPolicy'
import { PasswordStrengthBar } from './PasswordStrengthBar'

const schema = z
  .object({
    old_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(12, 'Password must be at least 12 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

type FormValues = z.infer<typeof schema>

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

export function ChangePasswordModal({ open, onClose }: Props) {
  const username = useAuthStore((s) => s.user?.username ?? '')
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })
  const newPwd = watch('new_password')

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      usersApi.changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      }),
    onSuccess: () => {
      toast.success('Password updated')
      reset()
      onClose()
    },
    onError: (err: AxiosError) => {
      if (err.response?.status === 400) {
        setError('old_password', { message: 'Current password is incorrect' })
      } else {
        toast.error('Failed to update password')
      }
    },
  })

  const handleClose = () => {
    reset()
    onClose()
  }

  const onSubmit = (values: FormValues) => {
    if (username && values.new_password.toLowerCase().includes(username.toLowerCase())) {
      setError('new_password', { message: 'Password must not contain your username' })
      return
    }
    if (isAppNamePassword(values.new_password)) {
      setError('new_password', { message: 'Password must not relate to the application name' })
      return
    }
    if (isCommonPassword(values.new_password)) {
      setError('new_password', { message: 'This password is too commonly used' })
      return
    }
    mutation.mutate(values)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">Change Password</Dialog.Title>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="old-pwd" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Current password
              </label>
              <input
                id="old-pwd"
                type="password"
                {...register('old_password')}
                autoFocus
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.old_password && <p className="mt-1 text-xs text-red-600">{errors.old_password.message}</p>}
            </div>

            <div>
              <label htmlFor="new-pwd" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                New password
              </label>
              <input
                id="new-pwd"
                type="password"
                {...register('new_password')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              <PasswordStrengthBar password={newPwd ?? ''} />
              {errors.new_password && <p className="mt-1 text-xs text-red-600">{errors.new_password.message}</p>}
            </div>

            <div>
              <label htmlFor="confirm-pwd" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Confirm password
              </label>
              <input
                id="confirm-pwd"
                type="password"
                {...register('confirm_password')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              {errors.confirm_password && <p className="mt-1 text-xs text-red-600">{errors.confirm_password.message}</p>}
            </div>

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
