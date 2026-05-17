import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProjects'
import { useUiStore } from '@/stores/uiStore'
import { useSSE } from '@/hooks/useSSE'
import { EditLockButton } from '@/components/EditLockButton'
import { PIListPanel } from '@/components/PIListPanel'
import { ToastContainer } from '@/components/ToastContainer'
import { LoginPage } from '@/pages/LoginPage'
import { ProjectListPage } from '@/pages/ProjectListPage'
import { BacklogPage } from '@/pages/BacklogPage'
import { PIBoardPage } from '@/pages/PIBoardPage'

export default function App() {
  const { data: user, isLoading, isError } = useCurrentUser()
  const logout = useLogout()
  const { activeProjectId, activePIId, setActiveProject } = useUiStore()
  const { data: activeProject } = useProject(activeProjectId ?? '')

  // Real-time updates for all open-project users
  useSSE(activeProjectId)

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
            className="flex items-center gap-1.5 text-lg font-semibold text-gray-900 hover:text-blue-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
              <polyline points="9 21 9 12 15 12 15 21" />
            </svg>
            PI Planner
          </button>
          {activeProject && (
            <>
              <span className="text-gray-300">/</span>
              <span className="text-sm font-medium text-gray-600">{activeProject.name}</span>
            </>
          )}
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

      <main className="flex h-[calc(100vh-49px)]">
        {activeProjectId ? (
          <>
            <PIListPanel projectId={activeProjectId} />
            <div className="flex-1 overflow-hidden">
              {activePIId ? (
                <PIBoardPage projectId={activeProjectId} piId={activePIId} />
              ) : (
                <div className="h-full">
                  <BacklogPage projectId={activeProjectId} />
                </div>
              )}
            </div>
          </>
        ) : (
          <ProjectListPage />
        )}
      </main>

      <ToastContainer />
    </div>
  )
}
