// Conversations with agents: validation, prompt composition and read-only CLI
// arguments. Pure functions only, so the browser demo and tests can share them.

export const MAX_CHAT_MESSAGE = 4000
export const MAX_CHAT_REPLY = 20_000
export const MAX_CHAT_HISTORY = 60
// The most recent turns that are replayed to the provider as context.
const CONTEXT_TURNS = 20
const CONTEXT_CHARS = 12_000

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
// eslint-disable-next-line no-control-regex -- Allow tabs and newlines, nothing else below space.
const controlChars = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** Returns an error message, or null when the user's chat message is acceptable. */
export function validateChatMessage(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Write a message first.'
  if (value.length > MAX_CHAT_MESSAGE) return `Messages are limited to ${MAX_CHAT_MESSAGE} characters.`
  if (controlChars.test(value)) return 'The message contains unsupported characters.'
  return null
}

const validMessage = item => object(item) && typeof item.id === 'string' && item.id.length <= 80 &&
  (item.role === 'user' || item.role === 'agent') && typeof item.text === 'string' && item.text.length <= MAX_CHAT_REPLY &&
  typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) &&
  (item.provider == null || ['codex', 'claude', 'antigravity'].includes(item.provider)) &&
  (item.error == null || typeof item.error === 'boolean')

/** chats.json: { [agentId]: ChatMessage[] } */
export function validStoredChats(value) {
  return object(value) && Object.entries(value).every(([agentId, messages]) =>
    /^[a-zA-Z0-9-]{1,80}$/.test(agentId) && Array.isArray(messages) && messages.length <= MAX_CHAT_HISTORY && messages.every(validMessage))
}

/** Appends messages and keeps only the newest MAX_CHAT_HISTORY. */
export function appendChat(messages = [], ...added) {
  return [...messages, ...added].slice(-MAX_CHAT_HISTORY)
}

/** The instructions for one chat reply: the agent's profile, recent conversation and the new message. */
export function composeChatPrompt(agent, history, message) {
  const recent = []
  let size = 0
  for (const item of [...history].reverse().slice(0, CONTEXT_TURNS)) {
    if (item.error) continue
    const line = `${item.role === 'user' ? 'USER' : agent.name.toUpperCase()}: ${item.text}`
    if (size + line.length > CONTEXT_CHARS) break
    recent.unshift(line); size += line.length
  }
  return [
    `You are ${agent.name}, an AI assistant working inside Agent Office.`,
    `Your assigned role is ${agent.role}.`,
    `Your specialty is ${agent.specialty}.`,
    `Your team/department is ${agent.department}.`,
    'The user is chatting with you directly. Reply conversationally, in character, and keep answers focused and reasonably short unless the user asks for detail.',
    'This chat is read-only: you may read files in the project folder to answer questions, but you cannot edit files or run commands that change anything. If the user wants changes made, explain what you would do and suggest they assign it to you as a task.',
    ...(recent.length ? ['', 'CONVERSATION SO FAR:', ...recent] : []),
    '',
    'USER MESSAGE:',
    message,
  ].join('\n')
}

/**
 * Read-only CLI arguments for a chat reply. Chats never inherit an agent's task
 * permissions: Codex uses its read-only sandbox, Claude Code denies every
 * editing or shell tool, and Antigravity runs without accepting edits, so
 * anything that needs approval is soft-denied.
 */
export function chatArgs(id, workspace) {
  if (id === 'codex') return ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', workspace, '-']
  if (id === 'claude') return ['--print', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'default',
    '--disallowedTools', 'Bash,Edit,MultiEdit,Write,NotebookEdit', '--permission-prompts', 'none']
  if (id === 'antigravity') return ['--output-format', 'stream-json', '--disable-slash-commands']
  throw new Error('Unknown AI provider.')
}

export function chatCommand(provider, workspace, prompt) {
  const args = chatArgs(provider.id, workspace)
  if (provider.id === 'antigravity') args.unshift(`--print=${prompt}`)
  const script = /\.[cm]?js$/i.test(provider.bin)
  return { command: script ? process.execPath : provider.bin, args: script ? [provider.bin, ...args] : args,
    input: provider.id === 'antigravity' ? '' : prompt }
}
