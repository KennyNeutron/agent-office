import { useEffect, useMemo, type ReactNode } from 'react'
import { LanguageContext, locale, type LanguageContextValue } from './i18n'

export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = 'ltr'
    document.title = 'Agent Office · Mission control'
  }, [])
  const value = useMemo<LanguageContextValue>(() => {
    const t = (phrase: string) => phrase
    const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    const formatTime = (date: string | Date) => Number.isFinite(new Date(date).getTime()) ? clock.format(new Date(date)) : '—'
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    const formatAgo = (date: string) => {
      if (!Number.isFinite(new Date(date).getTime())) return '—'
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000))
      return minutes < 60 ? relative.format(-minutes, 'minute') : minutes < 1440 ? relative.format(-Math.floor(minutes / 60), 'hour') : relative.format(-Math.floor(minutes / 1440), 'day')
    }
    return { locale, t, formatTime, formatAgo }
  }, [])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
