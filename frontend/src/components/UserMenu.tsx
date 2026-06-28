import { useState, useRef, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ColorScheme } from '@/stores/settingsStore'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

interface DisplayToggleProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (v: boolean) => void
}

function DisplayToggle({ label, checked, onChange }: DisplayToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 ${
          checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
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

const SCHEMES: { value: ColorScheme; label: string }[] = [
  { value: 'light',  label: 'Light'  },
  { value: 'dark',   label: 'Dark'   },
  { value: 'system', label: 'System' },
]

function ThemePicker() {
  const colorScheme = useSettingsStore((s) => s.colorScheme)
  const setColorScheme = useSettingsStore((s) => s.setColorScheme)

  return (
    <div className="px-4 py-1.5">
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Theme</span>
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
        {SCHEMES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setColorScheme(value)}
            className={`flex-1 py-1 text-xs font-medium transition-colors ${
              colorScheme === value
                ? 'bg-blue-600 text-white'
                : 'bg-canvas text-gray-600 dark:text-gray-300 hover:bg-band'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
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
  const showFeatureNameInCard = useSettingsStore((s) => s.showFeatureNameInCard)
  const setShowFeatureNameInCard = useSettingsStore((s) => s.setShowFeatureNameInCard)
  const showPIEvents = useSettingsStore((s) => s.showPIEvents)
  const setShowPIEvents = useSettingsStore((s) => s.setShowPIEvents)

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
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
        >
          {displayName}
          <span className="text-gray-400 text-xs">▾</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1">
            <p className="px-4 pt-1.5 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Display</p>
            <DisplayToggle label="Show IDs" checked={showIds} onChange={setShowIds} />
            <DisplayToggle label="Show effort unit" checked={showEffortUnit} onChange={setShowEffortUnit} />
            <DisplayToggle label="Show feature name in sprint card" checked={showFeatureNameInCard} onChange={setShowFeatureNameInCard} />
            <DisplayToggle label="Show PI events" checked={showPIEvents} onChange={setShowPIEvents} />
            <ThemePicker />
            <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
            <button
              type="button"
              onClick={() => { setOpen(false); setChangePwdOpen(true) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
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
