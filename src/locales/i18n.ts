import { createContext, useContext } from 'react'

// The interface is English-only. `t` is kept as a pass-through so components
// keep a single place to format interface text, dates and relative times.
export const locale = 'en'

export type LanguageContextValue = {
  locale: typeof locale
  t: (phrase: string) => string
  formatTime: (date: string | Date) => string
  formatAgo: (date: string) => string
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be inside LanguageProvider')
  return value
}
