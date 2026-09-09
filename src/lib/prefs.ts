import { languages, type Language } from '@/lib/i18n'

export const themes = ['light', 'dark'] as const
export type Theme = typeof themes[number]
export const THEME_KEY = 'little-budget-theme'
export const LANGUAGE_KEY = 'little-budget-language'

function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A browser that refuses storage still gets the choice for this session.
  }
}

// No stored choice means follow the system, which is why the toggle itself only offers light and dark.
export function loadTheme(): Theme {
  const saved = stored(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function loadLanguage(): Language {
  const saved = stored(LANGUAGE_KEY)
  if (saved && languages.includes(saved as Language)) return saved as Language
  const preferred = typeof navigator === 'object' ? [navigator.language, ...(navigator.languages ?? [])] : []
  return preferred.some(tag => tag?.toLowerCase().startsWith('de')) ? 'de' : 'en'
}
