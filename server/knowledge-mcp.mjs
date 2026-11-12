#!/usr/bin/env node
// MCP server (stdio, newline-delimited JSON-RPC) that gives an agent's CLI
// session the team knowledge tools. Agent Office passes it to Claude Code and
// Codex for each task; it forwards calls to the local Agent Office API.
//   node knowledge-mcp.mjs --url http://127.0.0.1:4300 --workspace /abs/project --task <id> --agent <id>
import { createInterface } from 'node:readline'

const option = name => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] ?? '' : '' }
const BASE = option('url') || 'http://127.0.0.1:4300'
const context = { workspace: option('workspace'), taskId: option('task') || null, agentId: option('agent') || null }
const VERSION = '1.0.0'

const TOOLS = [
  { name: 'search_knowledge', description: 'Search the team knowledge base for this project: durable notes (decisions, conventions, gotchas, how things work) saved by teammates. Returns the best matching notes with ids.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Keywords, e.g. "payment retry webhook"' }, limit: { type: 'number', description: 'Maximum results (1-10, default 5)' } }, required: ['query'] } },
  { name: 'read_note', description: 'Read one team knowledge note in full by its id (from search_knowledge).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'add_note', description: 'Propose a durable knowledge note for teammates (a decision and its reason, a convention, a gotcha, or how part of the system works). It is saved as a draft that the user reviews. Do not log task progress.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'Short title' }, body: { type: 'string', description: '2-6 sentences with the insight' },
      tags: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths' } }, required: ['title', 'body'] } },
]

async function api(path, init = {}) {
  const response = await fetch(new URL(path, BASE), { ...init, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Agent Office returned ${response.status}.`)
  return body
}
const format = note => `# ${note.title}\nid: ${note.id}${note.tags.length ? `\ntags: ${note.tags.join(', ')}` : ''}${note.files.length ? `\nfiles: ${note.files.join(', ')}` : ''}\nupdated: ${note.updatedAt}\n\n${note.body}`

async function call(name, args = {}) {
  if (name === 'search_knowledge') {
    const params = new URLSearchParams({ workspace: context.workspace, q: String(args.query ?? ''), limit: String(Math.min(10, Math.max(1, Number(args.limit) || 5))) })
    if (context.taskId) params.set('task', context.taskId)
    const { results } = await api(`/api/knowledge/search?${params}`)
    if (!results.length) return 'No team notes match. Nothing has been recorded about this yet.'
    return results.map(({ note }) => { const body = note.body.replace(/\s+/g, ' '); return `- [${note.id}] ${note.title}: ${body.length > 300 ? body.slice(0, 300) + '…' : body}` }).join('\n')
  }
  if (name === 'read_note') {
    const params = new URLSearchParams({ workspace: context.workspace })
    if (context.taskId) params.set('task', context.taskId)
    const { note } = await api(`/api/knowledge/${encodeURIComponent(String(args.id ?? ''))}?${params}`)
    return format(note)
  }
  if (name === 'add_note') {
    const { note } = await api('/api/knowledge/drafts', { method: 'POST', body: JSON.stringify({ ...context, title: args.title, body: args.body, tags: args.tags, files: args.files }) })
    return `Saved draft "${note.title}" (${note.id}) for the user to review.`
  }
  throw new Error(`Unknown tool: ${name}`)
}

const send = message => process.stdout.write(JSON.stringify(message) + '\n')
async function handle(message) {
  const { id, method, params } = message
  const respond = result => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }) }
  if (method === 'initialize') return respond({ protocolVersion: params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'agent-office', version: VERSION } })
  if (method === 'ping') return respond({})
  if (method === 'tools/list') return respond({ tools: TOOLS })
  if (method === 'tools/call') {
    try { return respond({ content: [{ type: 'text', text: await call(params?.name, params?.arguments) }] }) }
    catch (error) { return respond({ content: [{ type: 'text', text: error.message }], isError: true }) }
  }
  if (id !== undefined && method) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  let message
  try { message = JSON.parse(line) } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
  for (const item of Array.isArray(message) ? message : [message]) void handle(item)
})
