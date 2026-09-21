/** Dark or light, remembered, and applied before React mounts so the page never
 *  flashes the wrong one. The OS preference decides only the first visit. */
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'shipyard:theme'

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* private window */ }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch { return 'dark' }
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => { applyTheme(theme) }, [theme])
  const toggle = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(KEY, next) } catch { /* private window */ }
      return next
    })
  }, [])
  return [theme, toggle]
}
