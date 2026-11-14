import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './locales/LanguageProvider'
import { hydrateSettings } from './settingsSync'

// Settings saved by the local API load before the first render reads them.
const ready = import.meta.env.MODE === 'public-demo' ? Promise.resolve() : hydrateSettings()

void ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider><App /></LanguageProvider>
  </StrictMode>,
))
