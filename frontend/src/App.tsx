import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { useUiStore } from '@/stores/uiStore'
import { EditLockButton } from '@/components/EditLockButton'
import { LoginPage } from '@/pages/LoginPage'
import { ProjectListPage } from '@/pages/ProjectListPage'
import { BacklogPage } from '@/pages/BacklogPage'

export default function App() {
  const { data: user, isLoading, isError } = useCurrentUser()
  const logout = useLogout()
  const { activeProjectId, setActiveProject } = useUiStore()

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveProject(null)}
            className="text-lg font-semibold text-gray-900 hover:text-blue-600"
          >
            PI Planning
          </button>
        </div>
        <div className="flex items-center gap-4">
          {activeProjectId && <EditLockButton projectId={activeProjectId} />}
          <span className="text-sm text-gray-600">{user.display_name ?? user.username}</span>
          <button
            onClick={() => logout.mutate()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <main>
        {activeProjectId ? (
          <BacklogPage projectId={activeProjectId} />
        ) : (
          <ProjectListPage />
        )}
      </main>
    </div>
  )
}
