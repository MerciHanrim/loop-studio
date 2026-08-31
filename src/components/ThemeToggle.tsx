import { useEffect, useState } from 'react'
import { useT, type MessageKey } from '../i18n'

type Mode = 'system' | 'light' | 'dark'
const KEY = 'loop-studio:theme'

function apply(mode: Mode) {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
}

const LABEL_KEY: Record<Mode, MessageKey> = {
  system: 'theme.auto',
  light: 'theme.light',
  dark: 'theme.dark',
}

export function ThemeToggle() {
  const t = useT()
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
    <button type="button" className="btn" onClick={cycle} title={t('theme.title')}>
      {t(LABEL_KEY[mode])}
    </button>
  )
}
