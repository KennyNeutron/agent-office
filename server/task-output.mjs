export const shrink = (value, max = 190) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value : ''

export function parseMessage(task, data, addEvent) {
  if (!object(data)) return
  const message = value => { if (text(value)) task.lastMessage = shrink(value, 500) }
  const failure = value => { task.failure = shrink(value, 500); addEvent(task, task.failure, 'error') }
  if (task.provider === 'claude') {
    if (data.type === 'system' && text(data.session_id)) task.threadId = data.session_id
    if (data.type === 'assistant') {
      for (const block of Array.isArray(data.message?.content) ? data.message.content : []) {
        if (!object(block)) continue
        if (block.type === 'tool_use' && text(block.name)) {
          task.phase = /WebSearch|WebFetch/i.test(block.name) ? 'researching' : 'coding'
          addEvent(task, `Claude used ${shrink(block.name)}.`)
        } else if (block.type === 'text' && text(block.text)) {
          message(block.text); addEvent(task, 'Claude replied: ' + shrink(block.text, 140))
        }
      }
    }
    if (data.type === 'result') {
      message(data.result)
      if (object(data.usage)) task.usage = data.usage
      if (Array.isArray(data.permission_denials) && data.permission_denials.length) {
        const tools = [...new Set(data.permission_denials.map(item => text(item?.tool_name)).filter(Boolean))]
        addEvent(task, shrink(`Claude Code blocked actions that required approval${tools.length ? ` (${tools.join(', ')})` : ''}. Check the agent reply for work that could not run.`, 350), 'error')
      }
      if (data.is_error || (text(data.subtype) && data.subtype !== 'success')) {
        failure(text(data.result) || (Array.isArray(data.errors) ? data.errors.filter(item => text(item)).join('; ') : '') || 'Claude Code reported an error.')
      }
      task.phase = 'finishing'; task.outputComplete = true
    }
    return
  }
  if (task.provider === 'antigravity') { parseAntigravity(task, data, addEvent, message, failure); return }
  if (data.type === 'thread.started' && text(data.thread_id)) task.threadId = data.thread_id
  else if (data.type === 'turn.started') { task.phase = 'thinking'; addEvent(task, 'Codex started the task.') }
  else if (['item.started', 'item.updated', 'item.completed'].includes(data.type)) {
    const item = object(data.item) ? data.item : {}
    const verb = data.type === 'item.started' ? 'Starting' : data.type === 'item.completed' ? 'Finished' : 'Updating'
    if (item.type === 'command_execution') {
      task.phase = 'coding'
      if (data.type !== 'item.updated') addEvent(task, `${verb} command: ${shrink(item.command)}`)
    } else if (item.type === 'file_change') {
      task.phase = 'coding'
      if (data.type !== 'item.updated') addEvent(task, `${verb} file changes.`)
    } else if (item.type === 'agent_message' && data.type === 'item.completed') {
      message(item.text); addEvent(task, 'Agent replied: ' + shrink(item.text, 140))
    } else if (item.type === 'mcp_tool_call' && data.type !== 'item.updated') {
      task.phase = 'researching'
      addEvent(task, `${verb} ${shrink(text(item.server) || 'MCP')} tool: ${shrink(text(item.tool) || 'unknown')}`)
    } else if (item.type === 'web_search' && data.type !== 'item.updated') {
      task.phase = 'researching'; addEvent(task, `${verb} web search.`)
    } else if (item.type === 'reasoning' && data.type === 'item.started') task.phase = 'thinking'
  } else if (data.type === 'turn.completed') {
    task.usage = object(data.usage) ? data.usage : null
    task.phase = 'finishing'; task.outputComplete = true
  } else if (data.type === 'turn.failed') {
    failure(text(data.error?.message) || text(data.message) || 'Codex did not complete the task.')
  } else if (data.type === 'error') {
    addEvent(task, shrink(data.error?.message || data.message || 'Codex reported a temporary problem.', 500), 'error')
  }
}

// Antigravity CLI (agy) stream-json: {event:'init'|'step_update'|'result', [event]: payload}.
// Per-step scratch state lives outside the task so it is never persisted.
const agyState = new WeakMap()
const AGY_TERMINAL = ['DONE', 'ERROR', 'CANCELED']
function parseAntigravity(task, data, addEvent, message, failure) {
  const payload = object(data[data.event]) ? data[data.event] : {}
  if (!agyState.has(task)) agyState.set(task, { tools: new Set(), replies: new Map() })
  const state = agyState.get(task)
  if (data.event === 'init' && text(data.conversation_id)) task.threadId = data.conversation_id
  if (data.event === 'step_update') {
    const step = payload.step_index, done = AGY_TERMINAL.includes(payload.state)
    if (payload.step_type === 'tool' && text(payload.tool_name)) {
      task.phase = /search|browser|web|read_url/i.test(payload.tool_name) ? 'researching' : 'coding'
      // Steps report ACTIVE then DONE/ERROR; log each tool once.
      if (!state.tools.has(step)) { state.tools.add(step); addEvent(task, `Antigravity used ${shrink(payload.tool_name)}.`) }
      const error = object(payload.tool_info?.error) ? payload.tool_info.error : null
      if (payload.state === 'ERROR' && error) addEvent(task, shrink(`${payload.tool_name} failed: ${text(error.message) || text(error.type) || 'tool error'}`, 400), 'error')
    } else if (payload.step_type === 'agent_response') {
      // Replies may stream as ACTIVE text deltas; log the whole reply once it is done.
      const reply = (state.replies.get(step) || '') + (text(payload.text_delta) ? payload.text_delta : '')
      if (!done) state.replies.set(step, reply)
      else {
        state.replies.delete(step)
        if (reply.trim()) { message(reply); addEvent(task, 'Antigravity replied: ' + shrink(reply.trim(), 140)) }
      }
      if (!done) task.phase = 'thinking'
    }
  }
  if (data.event === 'result') {
    message(payload.response)
    if (object(payload.usage)) task.usage = payload.usage
    const denied = Array.isArray(payload.denied_actions) ? [...new Set(payload.denied_actions.map(item => text(item?.display_name) || text(item?.action)).filter(Boolean))] : []
    if (denied.length) addEvent(task, shrink(`Antigravity CLI skipped actions that required approval (${denied.join(', ')}). Check the agent reply for work that could not run.`, 350), 'error')
    if (payload.status !== 'SUCCESS') failure(text(payload.error?.message) || text(payload.error) || `Antigravity CLI finished with status ${shrink(text(payload.status) || 'unknown', 40)}.`)
    task.phase = 'finishing'; task.outputComplete = true
  }
}

export function jsonLines(onMessage, onOversize = () => {}, max = 1024 * 1024) {
  let buffer = '', dropping = false
  const emit = line => { try { onMessage(JSON.parse(line)) } catch { /* Non-JSON CLI diagnostics. */ } }
  return {
    push(chunk) {
      // Bound individual records, rather than discarding earlier valid records
      // whenever Node happens to deliver a large chunk.
      for (const part of chunk.split(/(?<=\n)/)) {
        const ends = part.endsWith('\n')
        if (!dropping) {
          if (buffer.length + part.length > max) { dropping = true; buffer = ''; onOversize() }
          else buffer += part
        }
        if (ends) { if (!dropping) emit(buffer.trim()); buffer = ''; dropping = false }
      }
    },
    end() { if (buffer.trim() && !dropping) emit(buffer.trim()); buffer = ''; dropping = false },
  }
}
