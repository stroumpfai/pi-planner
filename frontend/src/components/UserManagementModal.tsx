import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { usersApi } from '@/services/users'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { isCommonPassword } from '@/utils/passwordPolicy'
import { ConfirmDialog } from './ConfirmDialog'
import type { User } from '@/types'

type Role = 'admin' | 'editor' | 'reader'

const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-red-100 text-red-800',
  editor: 'bg-blue-100 text-blue-800',
  reader: 'bg-gray-100 text-gray-700',
}

const createSchema = z
  .object({
    username: z.string().min(1, 'Username is required').max(64),
    display_name: z.string().max(128).optional(),
    role: z.enum(['admin', 'editor', 'reader']),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })
  .refine(
    (d) => !d.username || !d.password.toLowerCase().includes(d.username.toLowerCase()),
    { message: 'Password must not contain the username', path: ['password'] },
  )
  .refine((d) => !isCommonPassword(d.password), {
    message: 'This password is too commonly used',
    path: ['password'],
  })
type CreateValues = z.infer<typeof createSchema>

interface UserCardProps {
  readonly user: User
  readonly currentUsername: string
  readonly onDeleted: () => void
}

function UserCard({ user, currentUsername, onDeleted }: UserCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const [role, setRole] = useState<Role>(user.role)
  const queryClient = useQueryClient()
  const isSelf = user.username === currentUsername

  const resetPwdContainsUsername =
    resetPassword.length >= 8 && resetPassword.toLowerCase().includes(user.username.toLowerCase())
  const resetPwdCommon = resetPassword.length >= 8 && isCommonPassword(resetPassword)
  const resetPwdValid = resetPassword.length >= 8 && !resetPwdContainsUsername && !resetPwdCommon
  let resetPwdError: string | null = null
  if (resetPassword.length > 0 && resetPassword.length < 8) {
    resetPwdError = 'At least 8 characters required'
  } else if (resetPwdContainsUsername) {
    resetPwdError = 'Password must not contain the username'
  } else if (resetPwdCommon) {
    resetPwdError = 'This password is too commonly used'
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      usersApi.update(user.username, {
        display_name: displayName || null,
        role: isSelf ? undefined : role,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`Updated ${user.username}`)
      setExpanded(false)
    },
    onError: () => toast.error('Failed to update user'),
  })

  const resetMutation = useMutation({
    mutationFn: () => usersApi.resetPassword(user.username, { new_password: resetPassword }),
    onSuccess: () => {
      toast.success(`Password reset for ${user.username}`)
      setResetPassword('')
    },
    onError: () => toast.error('Failed to reset password'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => usersApi.delete(user.username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`Deleted ${user.username}`)
      onDeleted()
    },
    onError: () => toast.error('Failed to delete user'),
  })

  return (
    <>
      <div className="border border-gray-200 rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex-1 min-w-0">
            <span className="font-medium text-gray-900 text-sm">{user.username}</span>
            {user.display_name && (
              <span className="ml-2 text-gray-500 text-sm">{user.display_name}</span>
            )}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${ROLE_BADGE[user.role]}`}>
            {user.role}
          </span>
          <span className="text-gray-400 text-xs">{expanded ? '▾' : '▸'}</span>
        </button>

        {expanded && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-4">
            <div>
              <label htmlFor={`card-display-name-${user.username}`} className="block text-xs font-medium text-gray-600 mb-1">Display name</label>
              <input
                id={`card-display-name-${user.username}`}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={128}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>

            <div>
              {isSelf ? (
                <p className="text-xs text-gray-400 italic">You cannot change your own role</p>
              ) : (
                <>
                  <label htmlFor={`card-role-${user.username}`} className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                  <select
                    id={`card-role-${user.username}`}
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="reader">Reader</option>
                  </select>
                </>
              )}
            </div>

            {isSelf ? (
              <p className="text-xs text-gray-400 italic">Use "Change Password" from the user menu to update your own password.</p>
            ) : (
              <div>
                <label htmlFor={`card-reset-pwd-${user.username}`} className="block text-xs font-medium text-gray-600 mb-1">Reset password</label>
                <div className="flex gap-2">
                  <input
                    id={`card-reset-pwd-${user.username}`}
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                  <button
                    type="button"
                    disabled={!resetPwdValid || resetMutation.isPending}
                    onClick={() => resetMutation.mutate()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md disabled:opacity-40"
                  >
                    Reset
                  </button>
                </div>
                {resetPwdError && (
                  <p className="mt-1 text-xs text-red-600">{resetPwdError}</p>
                )}
              </div>
            )}

            <div className="flex justify-between pt-1">
              <button
                type="button"
                disabled={isSelf || deleteMutation.isPending}
                onClick={() => setConfirmDelete(true)}
                title={isSelf ? 'You cannot delete your own account' : undefined}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-40"
              >
                Delete
              </button>
              <button
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${user.username}?`}
        description="This will permanently delete the user and invalidate all their sessions. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

function AddUserForm({ onCreated }: { readonly onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'editor' },
  })

  const mutation = useMutation({
    mutationFn: (values: CreateValues) =>
      usersApi.create({
        username: values.username,
        display_name: values.display_name || null,
        role: values.role,
        password: values.password,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      reset()
      setOpen(false)
      onCreated()
    },
    onError: (err: AxiosError) => {
      if (err.response?.status === 409) {
        setError('username', { message: 'Username is already taken' })
      } else {
        toast.error('Failed to create user')
      }
    },
  })

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 border border-dashed border-blue-300 rounded-md transition-colors"
      >
        <span>▾ Add User</span>
      </button>
    )
  }

  return (
    <div className="border border-blue-200 rounded-md bg-blue-50 px-4 py-4">
      <p className="text-sm font-medium text-gray-800 mb-3">New User</p>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-user-username" className="block text-xs font-medium text-gray-600 mb-1">
              Username <span className="text-red-500">*</span>
            </label>
            <input
              id="new-user-username"
              {...register('username')}
              autoFocus
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            {errors.username && <p className="mt-0.5 text-xs text-red-600">{errors.username.message}</p>}
          </div>
          <div>
            <label htmlFor="new-user-display-name" className="block text-xs font-medium text-gray-600 mb-1">Display name</label>
            <input
              id="new-user-display-name"
              {...register('display_name')}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="new-user-role" className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            id="new-user-role"
            {...register('role')}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="reader">Reader</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-user-password" className="block text-xs font-medium text-gray-600 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              id="new-user-password"
              type="password"
              {...register('password')}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            {errors.password && <p className="mt-0.5 text-xs text-red-600">{errors.password.message}</p>}
          </div>
          <div>
            <label htmlFor="new-user-confirm-password" className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
            <input
              id="new-user-confirm-password"
              type="password"
              {...register('confirm_password')}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            {errors.confirm_password && <p className="mt-0.5 text-xs text-red-600">{errors.confirm_password.message}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => { reset(); setOpen(false) }}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
          >
            {isSubmitting ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  )
}

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

export function UserManagementModal({ open, onClose }: Props) {
  const currentUsername = useAuthStore((s) => s.user?.username ?? '')
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: open,
  })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-base font-semibold text-gray-900">User Management</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
            ) : (
              users.map((u) => (
                <UserCard
                  key={u.username}
                  user={u}
                  currentUsername={currentUsername}
                  onDeleted={() => {}}
                />
              ))
            )}

            <div className="pt-2">
              <AddUserForm onCreated={() => {}} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
