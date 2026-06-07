import { useState, useRef, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

interface DisplayToggleProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (v: boolean) => void
}

function DisplayToggle({ label, checked, onChange }: DisplayToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

interface Props {
  readonly displayName: string
}

export function UserMenu({ displayName }: Props) {
  const [open, setOpen] = useState(false)
  const [changePwdOpen, setChangePwdOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const showIds = useSettingsStore((s) => s.showIds)
  const setShowIds = useSettingsStore((s) => s.setShowIds)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const setShowEffortUnit = useSettingsStore((s) => s.setShowEffortUnit)

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
          <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
            <p className="px-4 pt-1.5 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Display</p>
            <DisplayToggle label="Show IDs" checked={showIds} onChange={setShowIds} />
            <DisplayToggle label="Show effort unit" checked={showEffortUnit} onChange={setShowEffortUnit} />
            <div className="my-1 border-t border-gray-100" />
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
