import { useEffect, useState } from 'react'

type Mode = 'system' | 'light' | 'dark'
const KEY = 'loop-studio:theme'

function apply(mode: Mode) {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
}

const LABEL: Record<Mode, string> = {
  system: '◐ Auto',
  light: '☀ Light',
  dark: '☾ Dark',
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem(KEY)
      return v === 'light' || v === 'dark' ? v : 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    apply(mode)
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* storage unavailable — ignore */
    }
  }, [mode])

  const cycle = () =>
    setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'))

  return (
    <button type="button" className="btn" onClick={cycle} title="Theme: system / light / dark">
      {LABEL[mode]}
    </button>
  )
}
