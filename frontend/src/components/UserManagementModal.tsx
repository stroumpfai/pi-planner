import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { usersApi } from '@/services/users'
import { apiKeysApi } from '@/services/apiKeys'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { isAppNamePassword, isCommonPassword } from '@/utils/passwordPolicy'
import { ConfirmDialog } from './ConfirmDialog'
import { PasswordStrengthBar } from './PasswordStrengthBar'
import type { User, ApiKey, ApiKeyCreate, ApiKeyCreateResponse } from '@/types'

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
    password: z.string().min(12, 'Password must be at least 12 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })
  .refine(
    (d) => d.password.length < 12 || !d.username || !d.password.toLowerCase().includes(d.username.toLowerCase()),
    { message: 'Password must not contain the username', path: ['password'] },
  )
  .refine((d) => d.password.length < 12 || !isAppNamePassword(d.password), {
    message: 'Password must not relate to the application name',
    path: ['password'],
  })
  .refine((d) => d.password.length < 12 || !isCommonPassword(d.password), {
    message: 'This password is too commonly used',
    path: ['password'],
  })
type CreateValues = z.infer<typeof createSchema>

const issueKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(64, 'Name must be at most 64 characters'),
  purpose: z.string().max(255, 'Purpose must be at most 255 characters').optional(),
  expires_in_days: z.string().optional(),
})
type IssueKeyValues = z.infer<typeof issueKeySchema>

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`
  const diffDays = Math.floor(diffHrs / 24)
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

// ── SecretRevealPanel ────────────────────────────────────────────────────────

interface SecretRevealPanelProps {
  readonly token: string
  readonly onDismiss: () => void
}

function SecretRevealPanel({ token, onDismiss }: SecretRevealPanelProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(token).then(() => setCopied(true)).catch(() => {
      toast.error('Failed to copy to clipboard')
    })
  }

  return (
    <Dialog.Root
      open
      onOpenChange={() => {
        // prevent closing by clicking outside — only "I've copied it" button closes
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
        <Dialog.Content
          className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 mb-2">API Key Created</Dialog.Title>
          <Dialog.Description className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
            Copy this secret now — it won&apos;t be shown again.
          </Dialog.Description>

          <div className="flex items-center gap-2">
            <code className="flex-1 block bg-gray-100 border border-gray-200 rounded-md px-3 py-2 text-sm font-mono break-all text-gray-800">
              {token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md"
            >
              I&apos;ve copied it
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── IssueKeyForm ─────────────────────────────────────────────────────────────

interface IssueKeyFormProps {
  readonly username: string
  readonly onCancel: () => void
  readonly onIssued: (response: ApiKeyCreateResponse) => void
}

function IssueKeyForm({ username, onCancel, onIssued }: IssueKeyFormProps) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<IssueKeyValues>({
    resolver: zodResolver(issueKeySchema),
    defaultValues: { expires_in_days: '90' },
  })

  const mutation = useMutation({
    mutationFn: (values: IssueKeyValues) => {
      const body: ApiKeyCreate = {
        username,
        name: values.name,
        purpose: values.purpose || undefined,
        expires_in_days:
          values.expires_in_days && values.expires_in_days !== 'never'
            ? Number.parseInt(values.expires_in_days, 10)
            : undefined,
      }
      return apiKeysApi.create(body)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      onIssued(data)
    },
    onError: () => toast.error('Failed to create API key'),
  })

  return (
    <div className="border border-blue-200 rounded-md bg-blue-50 px-4 py-4 mt-2">
      <p className="text-xs font-medium text-gray-700 mb-3">Issue key for {username}</p>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-3">
        <div>
          <label htmlFor={`key-name-${username}`} className="block text-xs font-medium text-gray-600 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id={`key-name-${username}`}
            {...register('name')}
            autoFocus
            placeholder="e.g. Claude MCP"
            maxLength={64}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          {errors.name && <p className="mt-0.5 text-xs text-red-600">{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor={`key-purpose-${username}`} className="block text-xs font-medium text-gray-600 mb-1">Purpose</label>
          <input
            id={`key-purpose-${username}`}
            {...register('purpose')}
            placeholder="Optional notes"
            maxLength={255}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          {errors.purpose && <p className="mt-0.5 text-xs text-red-600">{errors.purpose.message}</p>}
        </div>

        <div>
          <label htmlFor={`key-expires-${username}`} className="block text-xs font-medium text-gray-600 mb-1">Expires in</label>
          <select
            id={`key-expires-${username}`}
            {...register('expires_in_days')}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
            <option value="never">Never</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? 'Issuing…' : 'Issue Key'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── ApiKeyCard ───────────────────────────────────────────────────────────────

interface ApiKeyCardProps {
  readonly apiKey: ApiKey
  readonly onNewToken: (response: ApiKeyCreateResponse) => void
}

function ApiKeyCard({ apiKey, onNewToken }: ApiKeyCardProps) {
  const [confirmCycle, setConfirmCycle] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const queryClient = useQueryClient()

  const cycleMutation = useMutation({
    mutationFn: () => apiKeysApi.cycle(apiKey.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      onNewToken(data)
    },
    onError: () => toast.error('Failed to cycle key'),
  })

  const revokeMutation = useMutation({
    mutationFn: () => apiKeysApi.revoke(apiKey.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success(`Revoked key "${apiKey.name}"`)
    },
    onError: () => toast.error('Failed to revoke key'),
  })

  return (
    <>
      <div className="border border-gray-200 rounded-md px-4 py-3 bg-white space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">{apiKey.name}</p>
            {apiKey.purpose && (
              <p className="text-xs text-gray-500 mt-0.5">{apiKey.purpose}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Created: {formatDate(apiKey.created_at)}
              {apiKey.expires_at ? ` · Expires: ${formatDate(apiKey.expires_at)}` : ' · Never expires'}
            </p>
            {apiKey.last_used_at && (
              <p className="text-xs text-gray-400">
                Last used: {formatRelative(apiKey.last_used_at)}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setConfirmCycle(true)}
            disabled={cycleMutation.isPending || revokeMutation.isPending}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            Cycle
          </button>
          <button
            type="button"
            onClick={() => setConfirmRevoke(true)}
            disabled={cycleMutation.isPending || revokeMutation.isPending}
            className="px-3 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-40"
          >
            Revoke
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCycle}
        title="Cycle this key?"
        description="This will invalidate the current key immediately. Issue a new one?"
        confirmLabel="Cycle Key"
        onConfirm={() => { setConfirmCycle(false); cycleMutation.mutate() }}
        onCancel={() => setConfirmCycle(false)}
      />

      <ConfirmDialog
        open={confirmRevoke}
        title="Revoke this key?"
        description="This will permanently disable this key. Are you sure?"
        confirmLabel="Revoke"
        destructive
        onConfirm={() => { setConfirmRevoke(false); revokeMutation.mutate() }}
        onCancel={() => setConfirmRevoke(false)}
      />
    </>
  )
}

// ── UserKeySection ────────────────────────────────────────────────────────────

interface UserKeySectionProps {
  readonly username: string
  readonly displayName: string | null
  readonly keys: ApiKey[]
  readonly onNewToken: (response: ApiKeyCreateResponse) => void
}

function UserKeySection({ username, displayName, keys, onNewToken }: UserKeySectionProps) {
  const [issuingKey, setIssuingKey] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800">
          {displayName ? `${displayName} (${username})` : username}
        </p>
        {!issuingKey && (
          <button
            type="button"
            onClick={() => setIssuingKey(true)}
            className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 border border-dashed border-blue-300 rounded-md transition-colors"
          >
            + Issue Key
          </button>
        )}
      </div>

      {keys.length === 0 && !issuingKey && (
        <p className="text-xs text-gray-400 italic pl-1">No keys</p>
      )}

      {keys.map((key) => (
        <ApiKeyCard key={key.id} apiKey={key} onNewToken={onNewToken} />
      ))}

      {issuingKey && (
        <IssueKeyForm
          username={username}
          onCancel={() => setIssuingKey(false)}
          onIssued={(response) => {
            setIssuingKey(false)
            onNewToken(response)
          }}
        />
      )}
    </div>
  )
}

// ── ApiKeysTab ────────────────────────────────────────────────────────────────

interface ApiKeysTabProps {
  readonly isAdmin: boolean
  readonly users: User[]
}

function ApiKeysTab({ isAdmin, users }: ApiKeysTabProps) {
  const [revealedToken, setRevealedToken] = useState<ApiKeyCreateResponse | null>(null)
  const queryClient = useQueryClient()

  const { data: allKeys = [], isLoading, isError } = useQuery({
    queryKey: ['api-keys'],
    queryFn: apiKeysApi.listAll,
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">Admin only</p>
    )
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
  }

  if (isError) {
    return (
      <div className="text-sm text-red-600 py-4 text-center space-y-2">
        <p>Failed to load API keys.</p>
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['api-keys'] })}
          className="text-xs underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    )
  }

  // Only admin and editor users can have API keys
  const eligibleUsers = users.filter((u) => u.role === 'admin' || u.role === 'editor')

  return (
    <>
      <div className="space-y-6">
        {eligibleUsers.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">No admin or editor users found.</p>
        )}
        {eligibleUsers.map((user) => {
          const userKeys = allKeys.filter((k) => k.username === user.username && k.is_active)
          return (
            <UserKeySection
              key={user.username}
              username={user.username}
              displayName={user.display_name ?? null}
              keys={userKeys}
              onNewToken={setRevealedToken}
            />
          )
        })}
      </div>

      {revealedToken && (
        <SecretRevealPanel
          token={revealedToken.full_token}
          onDismiss={() => setRevealedToken(null)}
        />
      )}
    </>
  )
}

// ── UserCard ─────────────────────────────────────────────────────────────────

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
    resetPassword.length >= 12 && resetPassword.toLowerCase().includes(user.username.toLowerCase())
  const resetPwdAppName = resetPassword.length >= 12 && isAppNamePassword(resetPassword)
  const resetPwdCommon = resetPassword.length >= 12 && isCommonPassword(resetPassword)
  const resetPwdValid = resetPassword.length >= 12 && !resetPwdContainsUsername && !resetPwdAppName && !resetPwdCommon
  let resetPwdError: string | null = null
  if (resetPassword.length > 0 && resetPassword.length < 12) {
    resetPwdError = 'At least 12 characters required'
  } else if (resetPwdContainsUsername) {
    resetPwdError = 'Password must not contain the username'
  } else if (resetPwdAppName) {
    resetPwdError = 'Password must not relate to the application name'
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
                    placeholder="New password (min 12 chars)"
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
                <PasswordStrengthBar password={resetPassword} />
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

  const { register, handleSubmit, reset, watch, setError, formState: { errors, isSubmitting } } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'editor' },
  })
  const pwdValue = watch('password')

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
            <PasswordStrengthBar password={pwdValue ?? ''} />
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

// ── UserManagementModal ───────────────────────────────────────────────────────

interface Props {
  readonly open: boolean
  readonly onClose: () => void
}

export function UserManagementModal({ open, onClose }: Props) {
  const currentUser = useAuthStore((s) => s.user)
  const currentUsername = currentUser?.username ?? ''
  const isAdmin = currentUser?.role === 'admin'

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
            <Dialog.Title className="text-base font-semibold text-gray-900">Manage Team &amp; Access</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</Dialog.Close>
          </div>

          <Tabs.Root defaultValue="users" className="flex flex-col flex-1 min-h-0">
            <Tabs.List className="flex border-b border-gray-200 mb-4 shrink-0">
              <Tabs.Trigger
                value="users"
                className="px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 transition-colors"
              >
                Users
              </Tabs.Trigger>
              <Tabs.Trigger
                value="api-keys"
                className="px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 transition-colors"
              >
                API Keys
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="users" className="flex-1 overflow-y-auto space-y-2 pr-1">
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
            </Tabs.Content>

            <Tabs.Content value="api-keys" className="flex-1 overflow-y-auto pr-1">
              <ApiKeysTab isAdmin={isAdmin} users={users} />
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
