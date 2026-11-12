import { useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AgentId, Department, OfficeAgent, OfficeTask, PermissionMode, ProviderId, ProviderInfo } from '../types';
import { DEPARTMENTS, displayAgentText, suggestDepartment, useAgents } from '../agents';
import { useLanguage } from '../locales/i18n';
import { Avatar, Dot } from '../components/Avatar';
import { icons } from '../components/taskDisplay';
import { Modal } from '../components/Modal';

type AgentInput = Omit<OfficeAgent, 'id' | 'short'>;
const blank: AgentInput = { name: '', role: '', specialty: '', department: 'general', color: '#8b82ff', provider: null, permissionMode: 'restricted' };
const PROVIDER_NAMES: Record<ProviderId, string> = { codex: 'Codex CLI', claude: 'Claude Code', antigravity: 'Antigravity CLI' };
const PERMISSION_NAMES: Record<PermissionMode, string> = { restricted: 'Restricted', 'approve-for-me': 'Approve for me', 'full-access': 'Full Access' };

export function Team({ tasks, providers, onTask, onChat, onSave, onDelete, connected, demo }: {
  tasks: OfficeTask[];
  providers: ProviderInfo[];
  onTask: (id: AgentId) => void;
  onChat: (id: AgentId) => void;
  onSave: (agent: AgentInput, id?: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  connected: boolean;
  demo: boolean;
}) {
  const { t: tr } = useLanguage();
  const agents = useAgents();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<AgentInput>(blank);
  const [customDepartment, setCustomDepartment] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const open = (agent?: OfficeAgent) => {
    setError('');
    setForm(agent ? { name: agent.name, role: agent.role, specialty: agent.specialty, department: agent.department, color: agent.color,
      provider: agent.provider ?? null, permissionMode: agent.permissionMode ?? 'restricted' } : blank);
    setCustomDepartment(Boolean(agent));
    setEditing(agent?.id ?? 'new');
  };
  const providerName = (id: ProviderId) => providers.find(item => item.id === id)?.name || PROVIDER_NAMES[id];
  const changeProfile = (field: 'role' | 'specialty', value: string) => {
    setForm(previous => {
      const next = { ...previous, [field]: value };
      return customDepartment ? next : { ...next, department: suggestDepartment(next.role, next.specialty) };
    });
  };
  const save = async () => {
    if (pending.current || !connected || !form.name.trim() || !form.role.trim() || !form.specialty.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const ok = await onSave(form, editing === 'new' ? undefined : editing ?? undefined);
      if (ok) setEditing(null);
      else setError(tr('Unable to save agent'));
    } catch { setError(tr('Unable to save agent')); }
    finally { pending.current = false; setBusy(false); }
  };
  const remove = async (agent: OfficeAgent) => {
    if (pending.current || !connected) return;
    if (!window.confirm(`${tr('Remove agent')} ${agent.name}? ${tr('Their saved task history will remain.')}`)) return;
    pending.current = true; setBusy(true);
    try { await onDelete(agent.id); }
    catch { setError(tr('Unable to remove agent')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <div className="sub-intro team-intro"><div><span className="eyebrow"><span /> {tr('YOUR DIGITAL CREW')}</span><h1>{tr('Meet your agents')}</h1><p>{tr('Organize specialists into departments. The office expands automatically with your team.')}</p></div>
      <button className="primary-btn" disabled={!connected || busy} onClick={() => open()}><Plus size={17}/>{tr('Add agent')}</button>
    </div>
    {!connected && <p className="roster-warning">{tr('Connect to your local API to manage agents.')}</p>}
    {demo && <p className="roster-warning">{tr('Demo changes stay in this browser.')}</p>}
    {error && !editing && <p className="form-error" role="alert">{error}</p>}
    {agents.length === 0 && <div className="empty-state"><h3>{tr('No agents yet')}</h3><p>{tr('Add your first agent to build the office.')}</p></div>}
    <div className="department-summary">{DEPARTMENTS.filter(dep => agents.some(agent => agent.department === dep.id)).map(dep => <span key={dep.id}><i style={{ background: dep.color }}/>{tr(dep.name)} · {agents.filter(agent => agent.department === dep.id).length}</span>)}</div>
    <div className="agents-grid">{agents.map(a => {
      const Icon = icons[a.department];
      const working = tasks.some(t => t.agentId === a.id && t.status === 'running');
      return <article className="agent-card" key={a.id}><div className="agent-card-accent" style={{ background: a.color }}/>
        <div className="agent-card-row"><Avatar id={a.id} size="lg"/><span className={`pill-status ${working ? 'running' : 'idle'}`}><Dot status={working ? 'running' : 'idle'}/>{working ? tr('Working') : tr('Available')}</span></div>
        <h2>{a.name}</h2><span className="agent-role"><Icon size={16}/>{displayAgentText(a, 'role', tr)}</span><p>{displayAgentText(a, 'specialty', tr)}</p>
        <span className="department-pill">{tr(DEPARTMENTS.find(dep => dep.id === a.department)?.name || 'Shared workstations')}</span>
        {(a.provider || (a.permissionMode && a.permissionMode !== 'restricted')) && <span className="department-pill agent-defaults" title={tr('Default AI provider and permissions')}>
          {a.provider ? providerName(a.provider) : tr('Office default')} · {tr(PERMISSION_NAMES[a.permissionMode ?? 'restricted'])}</span>}
        <div className="agent-card-foot"><span>{tasks.filter(t => t.agentId === a.id).length} {tr('total tasks')}</span><div className="roster-actions">
          <button title={tr('Edit agent')} aria-label={`${tr('Edit agent')} ${a.name}`} onClick={() => open(a)} disabled={!connected || busy}><Pencil size={15}/></button>
          <button title={tr('Remove agent')} aria-label={`${tr('Remove agent')} ${a.name}`} onClick={() => remove(a)} disabled={!connected || working || busy}><Trash2 size={15}/></button>
          <button title={tr('Chat')} aria-label={`${tr('Chat with')} ${a.name}`} onClick={() => onChat(a.id)}><MessageCircle size={15}/></button>
          <button onClick={() => onTask(a.id)}>{tr('Assign task')} <ArrowRight size={15}/></button>
        </div></div></article>;
    })}</div>
    {editing && <Modal close={() => setEditing(null)} busy={busy} labelledBy="agent-details"><form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="modal-title"><h2 id="agent-details">{tr(editing === 'new' ? 'Add agent' : 'Edit agent')}</h2><button type="button" disabled={busy} onClick={() => setEditing(null)} aria-label={tr('Close')}><X size={18}/></button></div>
      <fieldset disabled={busy}><div className="agent-fields"><label htmlFor="agent-name">{tr('Name')}</label><input id="agent-name" maxLength={45} required data-autofocus value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))}/>
        <label htmlFor="agent-role">{tr('Role')}</label><input id="agent-role" maxLength={70} required placeholder={tr('Developer, Researcher, Security engineer…')} value={form.role} onChange={e => changeProfile('role', e.target.value)}/>
        <label htmlFor="agent-specialty">{tr('Specialty / mission')}</label><textarea id="agent-specialty" required rows={3} maxLength={180} placeholder={tr('What does this agent do?')} value={form.specialty} onChange={e => changeProfile('specialty', e.target.value)}/>
        <label htmlFor="agent-department">{tr('Department')}</label><select id="agent-department" className="language-picker" value={form.department} onChange={e => { setCustomDepartment(true); setForm(v => ({ ...v, department: e.target.value as Department })); }}>{DEPARTMENTS.map(dep => <option value={dep.id} key={dep.id}>{tr(dep.name)}</option>)}</select>
        <small className="department-hint">{tr(customDepartment ? 'Department selected manually.' : 'Suggested from the role and mission. You can change it.')}</small>
        <label htmlFor="agent-color">{tr('Color')}</label><input id="agent-color" type="color" value={form.color} onChange={e => setForm(v => ({ ...v, color: e.target.value }))}/>
        <label htmlFor="agent-provider">{tr('Default AI provider')}</label><select id="agent-provider" className="language-picker" value={form.provider ?? ''}
          onChange={e => { const provider = (e.target.value || null) as ProviderId | null; setForm(v => ({ ...v, provider, permissionMode: provider === 'antigravity' && v.permissionMode === 'approve-for-me' ? 'restricted' : v.permissionMode })); }}>
          <option value="">{tr('Office default (last used)')}</option>
          {(Object.keys(PROVIDER_NAMES) as ProviderId[]).map(id => { const missing = !demo && providers.length > 0 && !providers.some(item => item.id === id && item.available);
            return <option key={id} value={id}>{providerName(id)}{missing ? ` (${tr('NOT FOUND')})` : ''}</option>; })}
        </select>
        <label htmlFor="agent-permissions">{tr('Default permissions')}</label><select id="agent-permissions" className="language-picker" value={form.permissionMode ?? 'restricted'} aria-describedby="agent-permissions-help"
          onChange={e => setForm(v => ({ ...v, permissionMode: e.target.value as PermissionMode }))}>
          <option value="restricted">{tr('Restricted')}</option>
          <option value="approve-for-me" disabled={form.provider === 'antigravity'}>{tr('Approve for me')}</option>
          <option value="full-access">{tr('Full Access')}</option>
        </select>
        <small id="agent-permissions-help" className="department-hint">{tr(form.permissionMode === 'full-access'
          ? 'Tasks and schedules that follow this agent can edit files outside the project and run commands with your account permissions.'
          : 'Pre-filled when you assign this agent a task, and used by schedules that follow the agent.')}</small>
      </div></fieldset>{error && <p id="agent-error" className="form-error" role="alert">{error}</p>}
      {!connected && <p className="form-error" role="status">{tr('API OFFLINE')}</p>}
      <div className="modal-bottom"><small>{tr(demo ? 'Demo changes stay in this browser.' : 'Agent profile and office placement are saved locally.')}</small><button type="submit" className="primary-btn" aria-describedby={error ? 'agent-error' : undefined} disabled={busy || !connected || !form.name.trim() || !form.role.trim() || !form.specialty.trim()}>{tr(busy ? 'Starting...' : 'Save agent')} <ArrowRight size={16}/></button></div>
    </form></Modal>}
  </>;
}
