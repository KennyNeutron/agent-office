import { createContext, useContext } from 'react'
import { languagePacks } from './translations.generated'

// Keep the English source phrases in a single, ordered catalogue. Language packs
// are checked for completeness before being offered in Settings.
export const phrases = `MISSION CONTROL
WORKSPACE
Office studio
Activity & tasks
Agent team
YOUR TEAM
Big ideas start small.
Give your agents a mission and watch it come to life.
Create a task
Settings
Local workspace
Personal edition
In progress
Completed
Failed
Cancelled
Interrupted
Available
WELCOME TO YOUR WORKSPACE
Mission control
Your agents are ready to bring ideas to life. Here's what's happening.
New task
Total agents
agents
Ready to collaborate
Working now
active
Making progress
Waiting for a mission
Tasks completed
tasks
Across your workspace
Workspace status
Demo mode
Connected
Offline
Sample activity only
Codex is available
Check local API
Live office
A little world where big things happen
DEMO FEED
LIVE FEED
3D VIEW
Loading 3D office…
MAIN FLOOR
agents working
Click an agent to inspect
Drag to orbit
Scroll to zoom
Meet your crew
Click any team member to see what they're up to.
MEMBERS
Working
Operations
SELECTED AGENT
Current status
Working on a task
Available for work
Assign a task
Task feed
A clean slate
Assign a task to see your team in action.
LATEST ACTIVITY
Awaiting agent updates.
Local connection monitored
EXECUTION HISTORY
Follow the details of every mission, in real time.
Search tasks or agents...
All tasks
Show agent
Stop task
No matching tasks
New activity will appear here.
YOUR DIGITAL CREW
Meet your agents
Four specialists, one shared mission.
total tasks
Assign task
YOUR ENVIRONMENT
Workspace settings
Choose where your agents work and which data you want to see.
Project directory
Absolute path to the folder Codex should work in.
WORKSPACE PATH
Each task uses the Codex workspace-write sandbox. Agents running in the same folder can change the same files; use separate projects for independent tasks.
Data source
Switch between sample activity and real Codex execution.
Demo environment
Sample events for exploring the office
Local Codex CLI
Detected on this computer
Start API and install Codex CLI
READY
NOT FOUND
Privacy & safety
Your office runs locally.
The API binds only to 127.0.0.1, checks browser origin and forwards prompts to your installed Codex CLI. Task summaries are saved in .local/tasks.json. Demo mode does not execute commands.
Language
Select your preferred interface language.
INTERFACE LANGUAGE
Changes take effect immediately and are saved on this device.
A NEW MISSION
Close
WHAT DO YOU WANT TO BUILD?
Example: Analyze this project, identify performance bottlenecks and improve them...
ASSIGN TO
PROJECT DIRECTORY
Absolute project path
Preview only · no real execution
Runs locally with Codex
Starting...
Launch task
My workspace
CODEX READY
API OFFLINE
DEMO MODE
LIVE MODE
Made for builders
Open source
Dismiss toast
Demo task started · preview only
Codex task started
Could not start task
Preview stopped
Cancellation requested
Cancellation failed
Showing real Codex events
Showing demo preview
Preview started. No code is executed.
Simulating agent activity...
Preview task completed.
Build the dashboard components and connect real-time events.
Review architecture and map the implementation plan.
Check API health and validate current changes.
Started implementing the dashboard.
Updated Dashboard.tsx and styles.
Running type checks.
Reviewing dependencies and architecture.
Checks completed successfully.
Demo workspace
Tech Lead
Developer
Creative
QA Engineer
Architecture & planning
Code & implementation
Design & experience
Tests & reliability
Execution inspector
Current phase
Elapsed time
Last update
Activity timeline
No events recorded yet.
No task assigned yet.
Thinking
Coding
Researching
Finishing
Idle
Error details
Started
Finished
Input tokens
Output tokens
AI provider
Runs locally with selected CLI
One task per project folder
Choose the CLI used for each task.
Start API and install an AI CLI
The API runs on your computer. Tasks use your installed AI CLI. Recent activity stays in .local/tasks.json.
Add agent
Edit agent
Remove agent
Save agent
Agent details
Name
Role
Specialty / mission
Department
Color
No agents yet
Add your first agent to build the office.
Organize specialists into departments. The office expands automatically with your team.
Connect to your local API to manage agents.
Their saved task history will remain.
Agent profile and office placement are saved locally.
Engineering lab
Creative studio
Quality & testing
Research library
Operations center
Security operations
Data & analytics
Shared workstations
Suggested from the role and mission. You can change it.
Department selected manually.
Developer, Researcher, Security engineer…
What does this agent do?
Agent created
Agent updated
Agent removed
Unable to save agent
Unable to remove agent
Add an agent to create tasks
Former agent
Show entire office
Office appearance
Customize the virtual workspace. Saved only in this browser.
Visual style
Bright modern
Midnight
Warm studio
Room spacing
Compact
Balanced
Spacious
Agent movement
Off
Subtle
Lively
Office accent color
Social animations
Visual interactions are simulated, not real AI conversations.
Restore office defaults
Skip to content
Showing real AI events
Loading workspace…
Showing saved activity; the API is offline.
Unable to load workspace
Retry
No AI provider is available.
Choose an available AI provider.
Agent is already working.
Enter an absolute project path.
No confirmation received. Check task history before trying again.
Task started
Invalid agent details
Preview is limited to 1000 agents
Demo changes stay in this browser.
AI CLI is available
OFFICE 01`.split('\n')

export const languages = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
] as const

export type Locale = typeof languages[number]['code']
export const localeCodes = languages.map(language => language.code)
export const localeStorageKey = 'agent-office-language'
const dictionary = new Map<string, Record<string, string>>()

export function translateText(locale: Locale, phrase: string): string {
  const pack = dictionary.get(locale)
  return pack && Object.hasOwn(pack, phrase) ? pack[phrase] : phrase
}

/** Registers a complete language pack; incomplete packs are rejected so the UI never silently mixes languages. */
export function registerLanguage(locale: Locale, lines: string) {
  const translated = lines.trim().split('\n').map(line => line.trim())
  if (translated.length !== phrases.length || translated.some(line => !line)) {
    throw new Error(`Incomplete translation pack: ${locale} (${translated.length}/${phrases.length})`)
  }
  dictionary.set(locale, Object.fromEntries(phrases.map((phrase, index) => [phrase, translated[index]])))
}

for (const language of languages) {
  if (language.code === 'en') continue
  registerLanguage(language.code, languagePacks[language.code].join('\n'))
}

function resolveLocale(value?: string | null): Locale | null {
  if (!value) return null
  const exact = languages.find(item => item.code.toLowerCase() === value.toLowerCase())
  if (exact) return exact.code
  const base = value.toLowerCase().split('-')[0]
  return languages.find(item => item.code.toLowerCase() === base)?.code
    ?? languages.find(item => item.code.toLowerCase().startsWith(`${base}-`))?.code ?? null
}

export function initialLocale(): Locale {
  try {
    const stored = resolveLocale(localStorage.getItem(localeStorageKey))
    if (stored) return stored
  } catch { /* Storage can be disabled in private browsing. */ }
  return 'en'
}

export type LanguageContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
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
