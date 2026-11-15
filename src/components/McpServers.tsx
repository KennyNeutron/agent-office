import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Braces, Globe, KeyRound, Pencil, Plus, Server, Terminal, Trash2, X } from 'lucide-react';
import type { McpServer, McpServerInput } from '../types';
import { useAgents } from '../agents';
import { Avatar } from './Avatar';
import { readResponse } from './dataFlow';
import { parseMcpJson } from './mcpImport';

type Pair = { key: string; value: string; saved: boolean };
type Draft = Omit<McpServerInput, 'env' | 'headers' | 'args'> & { args: string; env: Pair[]; headers: Pair[] };

const EMPTY: Draft = { name: '', description: '', transport: 'stdio', command: '', args: '', url: '', env: [], headers: [], agents: 'all', enabled: true, autoApprove: true };

function toDraft(server: McpServer): Draft {
  return { name: server.name, description: server.description, transport: server.transport, command: server.command, args: server.args.join('\n'), url: server.url,
    env: server.envKeys.map(key => ({ key, value: '', saved: true })), headers: server.headerKeys.map(key => ({ key, value: '', saved: true })),
    agents: server.agents, enabled: server.enabled, autoApprove: server.autoApprove };
}
/** Saved secrets are sent as null (keep), new values as text; removed rows are dropped. */
const pairsBody = (pairs: Pair[]) => Object.fromEntries(pairs.filter(pair => pair.key.trim())
  .map(pair => [pair.key.trim(), pair.saved && !pair.value ? null : pair.value]));
const toBody = (draft: Draft): McpServerInput => ({ ...draft, name: draft.name.trim(), command: draft.command.trim(), url: draft.url.trim(),
  args: draft.args.split('\n').map(arg => arg.trim()).filter(Boolean), env: pairsBody(draft.env), headers: pairsBody(draft.headers) });

function Pairs({ label, pairs, onChange, keyPlaceholder, valuePlaceholder }: {
  label: string; pairs: Pair[]; onChange: (pairs: Pair[]) => void; keyPlaceholder: string; valuePlaceholder: string;
}) {
  const update = (index: number, change: Partial<Pair>) => onChange(pairs.map((pair, i) => i === index ? { ...pair, ...change } : pair));
  return <fieldset className="mcp-pairs">
    <legend className="field-label">{label}</legend>
    {pairs.map((pair, index) => <div className="mcp-pair" key={index}>
      <input aria-label={`${label} name`} value={pair.key} placeholder={keyPlaceholder} readOnly={pair.saved} onChange={e => update(index, { key: e.target.value })}/>
      <input aria-label={`${label} value for ${pair.key || 'new entry'}`} type="password" autoComplete="off" value={pair.value}
        placeholder={pair.saved ? 'Saved · leave empty to keep' : valuePlaceholder} onChange={e => update(index, { value: e.target.value })}/>
      <button type="button" className="mcp-icon-btn" aria-label={`Remove ${pair.key || 'entry'}`} onClick={() => onChange(pairs.filter((_, i) => i !== index))}><X size={14}/></button>
    </div>)}
    <button type="button" className="mcp-add-row" onClick={() => onChange([...pairs, { key: '', value: '', saved: false }])}><Plus size={13}/>Add</button>
  </fieldset>;
}

function ServerForm({ initial, editing, saving, error, onSave, onCancel }: {
  initial: Draft; editing: boolean; saving: boolean; error: string; onSave: (draft: Draft) => void; onCancel: () => void;
}) {
  const agents = useAgents();
  const [draft, setDraft] = useState(initial);
  const [json, setJson] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const set = (change: Partial<Draft>) => setDraft(current => ({ ...current, ...change }));
  const chosen = draft.agents === 'all' ? [] : draft.agents;
  function importJson() {
    const result = parseMcpJson(json);
    if (typeof result === 'string') { setJsonError(result); return; }
    const first = result[0];
    const pairs = (values: Record<string, string | null>) => Object.entries(values).map(([key, value]) => ({ key, value: value ?? '', saved: false }));
    setDraft(current => ({ ...current, ...first, name: first.name || current.name, args: first.args.join('\n'), env: pairs(first.env), headers: pairs(first.headers) }));
    setJsonError(result.length > 1 ? `Filled in "${first.name}". ${result.length - 1} more server${result.length > 2 ? 's' : ''} in the JSON can be added one at a time.` : '');
    setJsonOpen(false);
  }
  function submit(event: FormEvent) { event.preventDefault(); onSave(draft); }
  return <form className="setting-card mcp-form" onSubmit={submit} aria-labelledby="mcp-form-title">
    <div className="mcp-form-head">
      <h2 id="mcp-form-title">{editing ? `Edit ${initial.name}` : 'Add an MCP server'}</h2>
      {!editing && <button type="button" className="office-reset" aria-expanded={jsonOpen} onClick={() => setJsonOpen(open => !open)}><Braces size={13}/>Paste JSON</button>}
    </div>
    {jsonOpen && <div className="mcp-json">
      <label htmlFor="mcp-json">Server JSON from the server's docs (Claude Code, Codex, Cursor or VS Code format)</label>
      <textarea id="mcp-json" value={json} rows={6} spellCheck={false} placeholder={'{\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }\n  }\n}'} onChange={e => setJson(e.target.value)}/>
      <div className="kb-actions"><button type="button" className="primary-btn" onClick={importJson} disabled={!json.trim()}>Fill in form</button></div>
    </div>}
    {jsonError && <p className="mcp-note" role="status">{jsonError}</p>}
    <div className="mcp-grid">
      <div><label htmlFor="mcp-name">Name</label><input id="mcp-name" data-autofocus value={draft.name} maxLength={40} placeholder="github" required onChange={e => set({ name: e.target.value })}/></div>
      <div><label htmlFor="mcp-description">Description (optional)</label><input id="mcp-description" value={draft.description} maxLength={300} placeholder="Issues and pull requests" onChange={e => set({ description: e.target.value })}/></div>
    </div>
    <div className="mcp-segment" role="radiogroup" aria-label="Server type">
      <button type="button" role="radio" aria-checked={draft.transport === 'stdio'} className={draft.transport === 'stdio' ? 'on' : ''} onClick={() => set({ transport: 'stdio' })}><Terminal size={14}/>Command (stdio)</button>
      <button type="button" role="radio" aria-checked={draft.transport === 'http'} className={draft.transport === 'http' ? 'on' : ''} onClick={() => set({ transport: 'http' })}><Globe size={14}/>URL (HTTP)</button>
    </div>
    {draft.transport === 'stdio' ? <>
      <label htmlFor="mcp-command">Command</label>
      <input id="mcp-command" className="mcp-mono" value={draft.command} placeholder="npx" required onChange={e => set({ command: e.target.value })}/>
      <label htmlFor="mcp-args">Arguments, one per line</label>
      <textarea id="mcp-args" className="mcp-mono" rows={3} value={draft.args} spellCheck={false} placeholder={'-y\n@modelcontextprotocol/server-github'} onChange={e => set({ args: e.target.value })}/>
      <Pairs label="Environment variables" pairs={draft.env} onChange={env => set({ env })} keyPlaceholder="GITHUB_TOKEN" valuePlaceholder="Value"/>
    </> : <>
      <label htmlFor="mcp-url">Server URL</label>
      <input id="mcp-url" className="mcp-mono" type="url" value={draft.url} placeholder="https://example.com/mcp" required onChange={e => set({ url: e.target.value })}/>
      <Pairs label="HTTP headers" pairs={draft.headers} onChange={headers => set({ headers })} keyPlaceholder="Authorization" valuePlaceholder="Bearer …"/>
    </>}
    <p className="mcp-note"><KeyRound size={12}/>Values are stored only on this computer and are never shown again or put on a command line.</p>
    <fieldset className="mcp-agents">
      <legend className="field-label">Agents that can use it</legend>
      <label className="mcp-check"><input type="radio" name="mcp-agents" checked={draft.agents === 'all'} onChange={() => set({ agents: 'all' })}/>All agents</label>
      <label className="mcp-check"><input type="radio" name="mcp-agents" checked={draft.agents !== 'all'} onChange={() => set({ agents: chosen })}/>Only these agents</label>
      {draft.agents !== 'all' && <div className="mcp-agent-picks">
        {agents.map(agent => <label key={agent.id} className={chosen.includes(agent.id) ? 'mcp-agent on' : 'mcp-agent'}>
          <input type="checkbox" checked={chosen.includes(agent.id)} onChange={e => set({ agents: e.target.checked ? [...chosen, agent.id] : chosen.filter(id => id !== agent.id) })}/>
          <Avatar id={agent.id} size="sm"/>{agent.name}
        </label>)}
        {!agents.length && <span className="mcp-note">No agents yet.</span>}
      </div>}
    </fieldset>
    <label className="mcp-check mcp-approve"><input type="checkbox" checked={draft.autoApprove} onChange={e => set({ autoApprove: e.target.checked })}/>
      <span><strong>Let agents use its tools without asking</strong><small>Agents run without permission prompts, so Claude Code and Codex skip tools that are not pre-approved.</small></span></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="kb-actions">
      <button type="button" className="office-reset" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add server'}</button>
    </div>
  </form>;
}

export function McpServers({ online, version }: { online: boolean; version: number }) {
  const agents = useAgents();
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const body = await readResponse(await fetch('/api/mcp', { signal: AbortSignal.timeout(15000) }), 'Could not load MCP servers');
      setServers(Array.isArray(body.servers) ? body.servers as McpServer[] : []); setLoadError('');
    } catch (problem) { setLoadError(problem instanceof Error ? problem.message : 'Could not load MCP servers'); }
  }, []);
  useEffect(() => {
    if (!online) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [online, version, load]);

  async function send(path: string, method: string, body?: unknown) {
    return readResponse(await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }), 'Could not save the MCP server');
  }
  async function save(draft: Draft) {
    setSaving(true); setError('');
    try {
      if (editing === 'new') await send('/api/mcp', 'POST', toBody(draft));
      else if (editing) await send('/api/mcp/' + encodeURIComponent(editing.id), 'PUT', toBody(draft));
      setEditing(null); await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save the MCP server'); }
    finally { setSaving(false); }
  }
  async function toggle(server: McpServer) {
    setBusy(server.id);
    try { await send('/api/mcp/' + encodeURIComponent(server.id), 'PUT', { enabled: !server.enabled }); await load(); }
    catch (problem) { setLoadError(problem instanceof Error ? problem.message : 'Could not save the MCP server'); }
    finally { setBusy(null); }
  }
  async function remove(server: McpServer) {
    if (!window.confirm(`Remove the MCP server "${server.name}"? Its saved keys are deleted too.`)) return;
    setBusy(server.id);
    try { await send('/api/mcp/' + encodeURIComponent(server.id), 'DELETE'); await load(); }
    catch (problem) { setLoadError(problem instanceof Error ? problem.message : 'Could not delete the MCP server'); }
    finally { setBusy(null); }
  }
  const agentNames = (server: McpServer) => server.agents === 'all' ? null : server.agents.filter(id => agents.some(agent => agent.id === id));

  if (editing) return <ServerForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? EMPTY : toDraft(editing)} editing={editing !== 'new'}
    saving={saving} error={error} onSave={save} onCancel={() => { setEditing(null); setError(''); }}/>;
  return <section className="tools-section" aria-labelledby="mcp-title">
    <div className="tools-section-head">
      <div><h2 id="mcp-title">MCP servers</h2><p>Saved on this computer and attached to every Claude Code and Codex task and chat of the agents you choose. Your CLIs' own settings are not changed. Antigravity CLI only reads its own settings, so it does not get these servers.</p></div>
      <button type="button" className="primary-btn" onClick={() => { setEditing('new'); setError(''); }}><Plus size={15}/>Add server</button>
    </div>
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {servers === null && !loadError && <p className="mcp-note" role="status">Loading…</p>}
    {servers?.length === 0 && <div className="kb-empty">
      <Server size={22}/><strong>No MCP servers yet</strong>
      <p>MCP servers give agents extra tools, such as GitHub, a database or your docs. Add one with its start command or URL, or paste the JSON snippet from its documentation.</p>
      <button type="button" className="primary-btn" onClick={() => setEditing('new')}><Plus size={14}/>Add your first server</button>
    </div>}
    {!!servers?.length && <ul className="mcp-list">
      {servers.map(server => {
        const only = agentNames(server);
        return <li key={server.id} className={server.enabled ? 'mcp-item' : 'mcp-item off'}>
          <span className="mcp-kind" aria-hidden="true">{server.transport === 'stdio' ? <Terminal size={16}/> : <Globe size={16}/>}</span>
          <div className="mcp-main">
            <strong>{server.name}{!server.autoApprove && <em className="mcp-badge">asks first</em>}</strong>
            {server.description && <small>{server.description}</small>}
            <code title={server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}>{server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}</code>
            <span className="mcp-meta">
              {only === null ? 'All agents' : only.length ? <span className="mcp-avatars">{only.slice(0, 6).map(id => <Avatar key={id} id={id} size="sm"/>)}{only.length > 6 && `+${only.length - 6}`}</span> : 'No agents'}
              {[...server.envKeys, ...server.headerKeys].length > 0 && <><i>·</i><KeyRound size={11}/>{[...server.envKeys, ...server.headerKeys].join(', ')}</>}
            </span>
          </div>
          <div className="mcp-actions">
            <button type="button" className={`switch ${server.enabled ? 'enabled' : ''}`} aria-pressed={server.enabled} aria-label={`${server.enabled ? 'Turn off' : 'Turn on'} ${server.name}`} disabled={busy === server.id} onClick={() => void toggle(server)}><span/></button>
            <button type="button" className="mcp-icon-btn" aria-label={`Edit ${server.name}`} onClick={() => { setEditing(server); setError(''); }}><Pencil size={14}/></button>
            <button type="button" className="mcp-icon-btn danger" aria-label={`Remove ${server.name}`} disabled={busy === server.id} onClick={() => void remove(server)}><Trash2 size={14}/></button>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}

