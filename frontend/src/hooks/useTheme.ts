import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

export function useTheme() {
  const colorScheme = useSettingsStore((s) => s.colorScheme)

  useEffect(() => {
    const root = document.documentElement
    if (colorScheme === 'dark') {
      root.classList.add('dark')
      return
    }
    if (colorScheme === 'light') {
      root.classList.remove('dark')
      return
    }
    // system — follow OS preference and react to changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (e: MediaQueryList | MediaQueryListEvent) =>
      root.classList.toggle('dark', e.matches)
    apply(mq)
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [colorScheme])
}
