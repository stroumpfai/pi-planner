import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { LoginPage } from '@/pages/LoginPage'

export default function App() {
  const { data: user, isLoading, isError } = useCurrentUser()
  const logout = useLogout()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-500 text-sm">Loading…</span>
      </div>
    )
  }

  if (isError || !user) {
    return <LoginPage />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">PI Planning</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user.display_name ?? user.username}</span>
          <button
            onClick={() => logout.mutate()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="p-8">
        <p className="text-gray-500 text-sm">Select or create a project to get started.</p>
      </main>
    </div>
  )
}
