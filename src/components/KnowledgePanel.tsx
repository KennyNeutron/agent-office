import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, Hash, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { AgentId, NoteInput, OfficeNote, OfficeTask } from '../types';
import { useAgents } from '../agents';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { readResponse } from './dataFlow';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { LIMITS, makeNote, normalizeTag, searchNotes, validateNoteInput } from '../../server/knowledge.mjs';
import { activeReaders, KNOWLEDGE_RECENT_MS, knowledgeQueries, knowledgeReaders } from '../scene/knowledgeGraphLayout';

type Tab = 'graph' | 'notes' | 'review' | 'graphify';
const LIST_LIMIT = 40;

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const excerpt = (text: string, max = 150) => { const flat = text.replace(/\s+/g, ' '); return flat.length > max ? flat.slice(0, max - 1) + '…' : flat; };

/** Sample knowledge for demo mode (kept in memory only). */
function demoNotes(workspace: string): OfficeNote[] {
  const at = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  const note = (input: NoteInput, hours: number, agentId: string | null, status: OfficeNote['status'] = 'active', source: OfficeNote['source'] = 'task') =>
    makeNote(input, { id: 'demo-note-' + normalizeTag(input.title), workspace, now: at(hours), status, source, agentId });
  return [
    note({ title: 'Task events are the only source of agent activity', body: 'The office never inspects files or processes directly. Everything the 3D scene shows (phases, graph reads, celebrations) is derived from the task events the CLI adapters emit, so new visuals should start by adding an event in task-output.mjs.', tags: ['architecture', 'events'], files: ['server/task-output.mjs', 'src/scene/agentBehavior.ts'] }, 30, 'atlas'),
    note({ title: 'Office simulation must stay deterministic', body: 'officeMotion uses seeded noise (idleRandom) instead of Math.random so tests can replay whole office days. Any new idle activity must draw its choices from idleRandom with a new salt.', tags: ['scene', 'testing'], files: ['src/scene/officeMotion.ts', 'scripts/test-office-layout.mjs'] }, 20, 'nova'),
    note({ title: 'Avoid filenames that differ only by case', body: 'Windows and macOS checkouts are case-insensitive, so KnowledgeGraph.tsx and knowledgeGraph.ts collide. Give logic modules a distinct name such as knowledgeGraphLayout.ts.', tags: ['gotcha', 'build'], files: ['src/scene/knowledgeGraphLayout.ts'] }, 12, 'sentinel'),
    note({ title: 'Schedules collapse missed runs into one', body: 'If the office was closed while several runs were due, the scheduler launches a single run when it starts again. A busy agent keeps the schedule waiting rather than failing it.', tags: ['schedules', 'architecture'], files: ['server/schedules.mjs', 'server/index.mjs'] }, 6, 'atlas'),
    note({ title: 'Label colours come from the agent profile', body: 'Every agent-specific colour (monitor glow, labels, avatar shirt) uses agent.color. Lead desks only add gold trim; never recolour the screen.', tags: ['scene', 'design'], files: ['src/scene/OfficeScene.tsx'] }, 2, 'pixel', 'draft'),
  ];
}

function NoteMeta({ note, now }: { note: OfficeNote; now: number }) {
  const agents = useAgents();
  const agent = agents.find(item => item.id === note.agentId);
  return <span className="kb-meta">
    {agent ? <><Avatar id={agent.id} size="sm"/>{agent.name}</> : <><BookOpen size={12}/>{note.source === 'manual' ? 'You' : 'Agent'}</>}
    <i>·</i>{note.status === 'draft' ? 'proposed' : 'updated'} {ago(Date.parse(note.updatedAt), now)}
  </span>;
}

function Chips({ note }: { note: OfficeNote }) {
  if (!note.tags.length && !note.files.length) return null;
  return <span className="kb-chips">
    {note.tags.map(tag => <span key={tag} className="kb-tag"><Hash size={10}/>{tag}</span>)}
    {note.files.map(file => <span key={file} className="kb-file" title={file}><FileText size={10}/>{file.split('/').at(-1)}</span>)}
  </span>;
}

function NoteEditor({ note, saving, onSave, onCancel }: { note: OfficeNote | null; saving: boolean; onSave: (input: NoteInput) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '');
  const [files, setFiles] = useState(note?.files.join(', ') ?? '');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { title, body, tags: tags.split(/[,\n]/), files: files.split(/[,\n]/) };
    const problem = validateNoteInput(input);
    if (problem) { setError(problem); return; }
    onSave(input);
  };
  return <form className="kb-editor" onSubmit={submit}>
    <label htmlFor="kb-title">TITLE</label>
    <input id="kb-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={LIMITS.title} placeholder="e.g. Payment retries are idempotent by order id" data-autofocus/>
    <label htmlFor="kb-body">NOTE</label>
    <textarea id="kb-body" value={body} onChange={event => setBody(event.target.value)} maxLength={LIMITS.body} placeholder="The durable insight: a decision and its reason, a convention, a gotcha, or how something works."/>
    <div className="kb-editor-row">
      <div><label htmlFor="kb-tags">TAGS</label><input id="kb-tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="payments, retries"/></div>
      <div><label htmlFor="kb-files">FILES</label><input id="kb-files" value={files} onChange={event => setFiles(event.target.value)} placeholder="src/payments/retry.ts"/></div>
    </div>
    {error && <p className="kb-error" role="alert">{error}</p>}
    <div className="kb-actions">
      <button type="button" className="office-reset" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="primary-btn" disabled={saving}><Check size={15}/>{saving ? 'Saving…' : 'Save note'}</button>
    </div>
  </form>;
}

/** The team knowledge base for the current project, plus graphify activity. */
export function KnowledgePanel({ tasks, workspace, demo, online, version, close, onShowTask }: {
  tasks: OfficeTask[];
  workspace: string;
  demo: boolean;
  online: boolean;
  /** Server knowledge version; a change means notes were edited elsewhere. */
  version: number;
  close: () => void;
  onShowTask: (agentId: AgentId, taskId: string) => void;
}) {
  const agents = useAgents();
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>('graph');
  const [notes, setNotes] = useState<OfficeNote[]>(() => demo ? demoNotes(workspace) : []);
  const [loaded, setLoaded] = useState(demo);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<OfficeNote | 'new' | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (demo) return;
    if (!online) { setError('The office is offline.'); return; }
    try {
      const body = await readResponse(await fetch('/api/knowledge?' + new URLSearchParams({ workspace }), { signal: AbortSignal.timeout(15000) }), 'Could not load team knowledge');
      setNotes(body.notes as OfficeNote[]); setError(''); setLoaded(true);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load team knowledge'); setLoaded(true); }
  }, [demo, online, workspace]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, version]);

  const send = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return readResponse(response, 'Could not save the note');
  };
  const run = async (action: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await action(); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save the note'); }
    finally { setSaving(false); }
  };
  const save = (input: NoteInput, previous: OfficeNote | null) => run(async () => {
    if (demo) {
      const note = makeNote(input, { id: 'demo-note-' + crypto.randomUUID(), workspace }, previous);
      setNotes(current => previous ? current.map(item => item.id === note.id ? note : item) : [note, ...current]);
      setSelected(note.id);
    } else {
      const { note } = previous ? await send('/api/knowledge/' + encodeURIComponent(previous.id), 'PUT', input) : await send('/api/knowledge', 'POST', { ...input, workspace });
      await load(); setSelected((note as OfficeNote).id);
    }
    setEditing(null);
  });
  const approve = (note: OfficeNote) => run(async () => {
    if (demo) setNotes(current => current.map(item => item.id === note.id ? { ...item, status: 'active', updatedAt: new Date().toISOString() } : item));
    else { await send('/api/knowledge/' + encodeURIComponent(note.id), 'PUT', { title: note.title, body: note.body, tags: note.tags, files: note.files, status: 'active' }); await load(); }
  });
  const remove = (note: OfficeNote) => run(async () => {
    if (!demo) await send('/api/knowledge/' + encodeURIComponent(note.id), 'DELETE');
    setNotes(current => current.filter(item => item.id !== note.id));
    if (selected === note.id) setSelected(null);
  });

  const active = useMemo(() => notes.filter(note => note.status === 'active'), [notes]);
  const drafts = useMemo(() => notes.filter(note => note.status === 'draft'), [notes]);
  const results = useMemo(() => query.trim() ? searchNotes(notes, query, { limit: 200, drafts: true }).map(item => item.note) : null, [notes, query]);
  // Graph nodes lit by the search: matching notes plus the tags and files they mention.
  const matches = useMemo(() => results && new Set(results.flatMap(note => [`note:${note.id}`, ...note.tags.map(tag => `tag:${tag}`), ...note.files.map(file => `file:${file}`)])), [results]);
  const chosen = notes.find(note => note.id === selected) ?? null;
  const graphNotes = useMemo(() => [...active, ...drafts], [active, drafts]);

  const queries = useMemo(() => knowledgeQueries(tasks), [tasks]);
  const reading = useMemo(() => activeReaders(knowledgeReaders(tasks), now), [tasks, now]);
  const name = (id: AgentId | null) => agents.find(agent => agent.id === id)?.name ?? 'Agent';

  const detail = (note: OfficeNote) => <article className="kb-detail">
    <div className="kb-detail-top">
      {note.status === 'draft' && <span className="kb-badge">Awaiting review</span>}
      <h3>{note.title}</h3>
      <NoteMeta note={note} now={now}/>
    </div>
    <p className="kb-body">{note.body}</p>
    <Chips note={note}/>
    {note.taskId && tasks.some(task => task.id === note.taskId) && <button type="button" className="link-btn kb-task-link" onClick={() => onShowTask(note.agentId ?? '', note.taskId!)}>From {name(note.agentId)}'s task <ArrowRight size={12}/></button>}
    <div className="kb-detail-actions">
      {note.status === 'draft' && <button type="button" className="kb-keep" onClick={() => approve(note)} disabled={saving}><Check size={14}/>Keep</button>}
      <button type="button" onClick={() => setEditing(note)} disabled={saving}><Pencil size={13}/>Edit</button>
      <button type="button" className="danger" onClick={() => remove(note)} disabled={saving}><Trash2 size={13}/>{note.status === 'draft' ? 'Discard' : 'Delete'}</button>
    </div>
  </article>;

  const tabs: [Tab, string, number | null][] = [['graph', 'Graph', null], ['notes', 'Notes', active.length], ['review', 'Review', drafts.length], ['graphify', 'Graphify activity', null]];

  return <Modal close={close} busy={saving} labelledBy="knowledge-title" wide>
    <div className="modal-title">
      <div><span className="eyebrow"><span /> TEAM KNOWLEDGE</span>
        <h2 id="knowledge-title">Knowledge base <b>✳</b></h2>
        <p className="kb-workspace" title={workspace}>{demo ? 'Demo notes · changes are not saved' : workspace}</p></div>
      <button type="button" onClick={close} disabled={saving} aria-label="Close"><X size={19}/></button>
    </div>

    {editing ? <>
      <button type="button" className="link-btn kb-back" onClick={() => setEditing(null)}><ArrowLeft size={13}/>Back</button>
      <NoteEditor note={editing === 'new' ? null : editing} saving={saving} onSave={input => save(input, editing === 'new' ? null : editing)} onCancel={() => setEditing(null)}/>
      {error && <p className="kb-error" role="alert">{error}</p>}
    </> : <>
      <div className="kb-toolbar">
        <div className="kb-tabs" role="tablist">
          {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
            {label}{count != null && count > 0 && <b className={id === 'review' ? 'attention' : ''}>{count}</b>}
          </button>)}
        </div>
        {tab !== 'graphify' && <div className="kb-tools">
          <label className="kb-search"><Search size={14}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes, tags, files" aria-label="Search knowledge"/></label>
          <button type="button" className="primary-btn kb-new" onClick={() => setEditing('new')} disabled={!demo && !online}><Plus size={15}/>New note</button>
        </div>}
      </div>
      {error && <p className="kb-error" role="alert">{error}</p>}

      {tab === 'graph' && (notes.length ? <div className="kb-graph-layout">
        <KnowledgeGraphView notes={graphNotes} matches={matches} selectedNote={selected} onSelectNote={setSelected}/>
        <aside className="kb-side">{chosen ? detail(chosen) : <div className="kb-side-help">
          <strong>{active.length} note{active.length === 1 ? '' : 's'}{drafts.length ? ` · ${drafts.length} to review` : ''}</strong>
          <p>Notes link to the tags and files they mention, so related knowledge clusters together. Hover a node to trace its links, click a note to read it, or click a tag or file to see everything connected to it.</p>
          {results && <p>{results.length} match{results.length === 1 ? '' : 'es'} for “{query}”.</p>}
        </div>}</aside>
      </div> : loaded && <Empty demo={demo} onNew={() => setEditing('new')}/>)}

      {tab === 'notes' && <div className="kb-split">
        <ul className="kb-list">
          {(results ? results.filter(note => note.status === 'active') : active).map(note => <li key={note.id}>
            <button type="button" className={selected === note.id ? 'selected' : ''} onClick={() => setSelected(note.id)}>
              <strong>{note.title}</strong><small>{excerpt(note.body)}</small><Chips note={note}/>
            </button>
          </li>)}
          {loaded && !(results ? results.some(note => note.status === 'active') : active.length) && <li className="schedule-empty"><BookOpen size={24}/><strong>{results ? 'No notes match' : 'No notes yet'}</strong><p>{results ? 'Try other keywords, or a tag or file name.' : 'Add one yourself, or keep a draft your agents proposed.'}</p></li>}
        </ul>
        <aside className="kb-side">{chosen && chosen.status === 'active' ? detail(chosen) : <div className="kb-side-help"><p>Select a note to read it.</p></div>}</aside>
      </div>}

      {tab === 'review' && <ul className="kb-review">
        {drafts.length ? drafts.map(note => <li key={note.id}>{detail(note)}</li>) : <li className="schedule-empty"><Check size={24}/><strong>Nothing to review</strong>
          <p>When an agent finishes a task with something worth remembering, or proposes a note through its knowledge tools, the draft waits here. Keep it to share it with the team.</p></li>}
      </ul>}

      {tab === 'graphify' && <GraphifyActivity queries={queries} reading={reading} now={now} name={name} onShowTask={onShowTask}/>}
    </>}
  </Modal>;
}

function Empty({ demo, onNew }: { demo: boolean; onNew: () => void }) {
  return <div className="schedule-empty kb-empty">
    <Network size={28}/>
    <strong>No team knowledge yet</strong>
    <p>Notes capture what your team learns about this project: decisions, conventions, gotchas, how things work. Agents propose notes when they finish tasks and receive the most relevant ones with every new task.</p>
    {!demo && <button type="button" className="primary-btn" onClick={onNew}><Plus size={15}/>Write the first note</button>}
  </div>;
}

function GraphifyActivity({ queries, reading, now, name, onShowTask }: {
  queries: ReturnType<typeof knowledgeQueries>; reading: ReturnType<typeof activeReaders>; now: number;
  name: (id: AgentId | null) => string; onShowTask: (agentId: AgentId, taskId: string) => void;
}) {
  const users = new Set(queries.map(query => query.agentId));
  return <div className="kb-graphify">
    <p className="knowledge-note">Your code graph lives in graphify; agents query it through graphify's MCP server. This is what they asked it recently.</p>
    <div className="knowledge-stats">
      <div><span>Reading now</span><strong>{reading.length}</strong></div>
      <div><span>Graph queries</span><strong>{queries.length}</strong></div>
      <div><span>Agents using it</span><strong>{users.size}</strong></div>
      <div><span>Last query</span><strong className="knowledge-tool">{queries[0] ? ago(queries[0].at, now) : '—'}</strong></div>
    </div>
    {reading.length > 0 && <ul className="knowledge-readers">{reading.map(reader => <li key={reader.agentId}><Avatar id={reader.agentId} size="sm"/>{name(reader.agentId)}<small>{ago(reader.at, now)}</small></li>)}</ul>}
    {!reading.length && <p className="knowledge-note">No agent has queried graphify in the last {KNOWLEDGE_RECENT_MS / 1000} seconds.</p>}
    <ul className="schedule-list knowledge-list">
      {queries.length ? queries.slice(0, LIST_LIMIT).map((query, index) => <li key={`${query.taskId}-${query.at}-${index}`}>
        <button type="button" className="knowledge-query" onClick={() => onShowTask(query.agentId, query.taskId)} title="Show this task">
          <Avatar id={query.agentId} size="sm"/>
          <span className="knowledge-query-main"><strong>{name(query.agentId)} <code>{query.tool}</code></strong><small>{query.prompt}</small></span>
          <span className="knowledge-query-side"><time dateTime={new Date(query.at).toISOString()}>{ago(query.at, now)}</time>{query.status === 'running' && <i>running</i>}<ArrowRight size={13}/></span>
        </button>
      </li>) : <li className="schedule-empty"><Network size={24}/><strong>No graphify queries yet</strong><p>Agents use graphify only when it is set up as an MCP server in their CLI.</p></li>}
    </ul>
  </div>;
}
