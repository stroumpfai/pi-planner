import { useState, useRef, useEffect } from 'react'
import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProjects'
import { useUiStore } from '@/stores/uiStore'
import { useSSE } from '@/hooks/useSSE'
import { useAuthStore } from '@/stores/authStore'
import { EditLockButton } from '@/components/EditLockButton'
import { PIListPanel } from '@/components/PIListPanel'
import { ToastContainer } from '@/components/ToastContainer'
import { UserManagementModal } from '@/components/UserManagementModal'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { LoginPage } from '@/pages/LoginPage'
import { ProjectListPage } from '@/pages/ProjectListPage'
import { BacklogPage } from '@/pages/BacklogPage'
import { PIBoardPage } from '@/pages/PIBoardPage'

function UserMenu({ displayName }: { readonly displayName: string }) {
  const [open, setOpen] = useState(false)
  const [changePwdOpen, setChangePwdOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          {displayName}
          <span className="text-gray-400 text-xs">▾</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setChangePwdOpen(true) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Change Password
            </button>
          </div>
        )}
      </div>

      <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
    </>
  )
}

export default function App() {
  const { data: user, isLoading, isError } = useCurrentUser()
  const logout = useLogout()
  const { activeProjectId, activePIId, setActiveProject } = useUiStore()
  const { data: activeProject } = useProject(activeProjectId ?? '')
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const [userMgmtOpen, setUserMgmtOpen] = useState(false)

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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setUserMgmtOpen(true)}
              title="Manage users"
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          <UserMenu displayName={user.display_name ?? user.username} />
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

      <UserManagementModal open={userMgmtOpen} onClose={() => setUserMgmtOpen(false)} />
      <ToastContainer />
    </div>
  )
}
