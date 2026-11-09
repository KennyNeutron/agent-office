import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarClock, Check, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import type { AgentId, OfficeSchedule, OfficeTask, PermissionMode, ProviderId, ProviderInfo, ScheduleInput, ScheduleRepeat } from '../types';
import { useAgents } from '../agents';
import { describeRepeat, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from '../../server/schedules.mjs';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { isAbsoluteWorkspace } from './dataFlow';
import { upcomingSchedules, formatScheduleTime, formatUntil } from './scheduleDisplay';

const PROVIDERS: ProviderInfo[] = [
  { id: 'codex', name: 'Codex CLI', available: false },
  { id: 'claude', name: 'Claude Code', available: false },
  { id: 'gemini', name: 'Gemini CLI', available: false },
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function splitInterval(minutes: number | null): { value: number; unit: Unit } {
  if (!minutes) return { value: 1, unit: 'hours' };
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

type Draft = {
  title: string; agentId: AgentId; prompt: string; provider: ProviderId; permissionMode: PermissionMode; workspace: string;
  repeat: ScheduleRepeat; runAt: string; intervalValue: number; intervalUnit: Unit; time: string; days: number[]; enabled: boolean;
};
function draftFrom(schedule: OfficeSchedule | null, agentId: AgentId, provider: ProviderId, workspace: string): Draft {
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setMinutes(0, 0, 0);
  const interval = splitInterval(schedule?.intervalMinutes ?? null);
  return {
    title: schedule?.title ?? '', agentId: schedule?.agentId ?? agentId, prompt: schedule?.prompt ?? '',
    provider: schedule?.provider ?? provider, permissionMode: schedule?.permissionMode ?? 'restricted',
    workspace: schedule?.workspace ?? workspace, repeat: schedule?.repeat ?? 'daily',
    runAt: schedule?.runAt ? localInput(new Date(schedule.runAt)) : localInput(soon),
    intervalValue: interval.value, intervalUnit: interval.unit, time: schedule?.time ?? '09:00',
    days: schedule?.days ?? [1, 2, 3, 4, 5], enabled: schedule?.enabled ?? true,
  };
}

export function ScheduleManager({ schedules, tasks, initialAgent, providers, defaultProvider, workspace, demo, online, close, onSave, onDelete, onRun, onShowTask }: {
  schedules: OfficeSchedule[];
  tasks: OfficeTask[];
  initialAgent: AgentId | null;
  providers: ProviderInfo[];
  defaultProvider: ProviderId;
  workspace: string;
  demo: boolean;
  online: boolean;
  close: () => void;
  onSave: (input: ScheduleInput, id?: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRun: (id: string) => Promise<boolean>;
  onShowTask: (agentId: AgentId, taskId: string) => void;
}) {
  const agents = useAgents();
  const [filter, setFilter] = useState<AgentId | null>(initialAgent);
  const [editing, setEditing] = useState<OfficeSchedule | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [openedAt, setOpenedAt] = useState(0);
  const options = providers.length ? providers : PROVIDERS;
  const connected = demo || online;

  const listed = useMemo(() => {
    const visible = schedules.filter(item => !filter || item.agentId === filter);
    // Active schedules first by next run, then paused/finished ones by name.
    return [...upcomingSchedules(visible), ...visible.filter(item => !item.enabled || !item.nextRunAt)
      .sort((a, b) => (a.title || a.prompt).localeCompare(b.title || b.prompt))];
  }, [schedules, filter]);

  function openForm(schedule: OfficeSchedule | 'new') {
    const agentId = schedule === 'new' ? filter ?? agents[0]?.id ?? '' : schedule.agentId;
    setDraft(draftFrom(schedule === 'new' ? null : schedule, agentId, defaultProvider, workspace));
    setEditing(schedule); setError(''); setOpenedAt(Date.now());
  }
  const update = (change: Partial<Draft>) => setDraft(value => value && { ...value, ...change });

  const minutes = draft ? Math.round(draft.intervalValue * UNITS[draft.intervalUnit]) : 0;
  const formError = !draft ? '' : !connected ? 'API OFFLINE'
    : !agents.some(item => item.id === draft.agentId) ? 'Choose an agent.'
    : !draft.prompt.trim() ? 'Describe the task to run.'
    : !demo && !isAbsoluteWorkspace(draft.workspace) ? 'Enter an absolute project path.'
    : (draft.repeat === 'once' || draft.repeat === 'interval') && !Number.isFinite(Date.parse(draft.runAt)) ? 'Choose a valid start date and time.'
    : draft.repeat === 'once' && draft.enabled && Date.parse(draft.runAt) < openedAt - 60_000 ? 'Choose a time in the future.'
    : draft.repeat === 'interval' && (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) ? `Repeat interval must be between ${MIN_INTERVAL_MINUTES} minutes and 7 days.`
    : (draft.repeat === 'daily' || draft.repeat === 'weekly') && !/^\d{2}:\d{2}$/.test(draft.time) ? 'Choose a valid time of day.'
    : draft.repeat === 'weekly' && !draft.days.length ? 'Choose at least one weekday.' : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || formError || busy) return;
    const input: ScheduleInput = {
      title: draft.title.trim(), agentId: draft.agentId, prompt: draft.prompt.trim(), provider: draft.provider,
      permissionMode: draft.provider === 'gemini' && draft.permissionMode === 'approve-for-me' ? 'restricted' : draft.permissionMode,
      workspace: demo ? 'Demo workspace' : draft.workspace, repeat: draft.repeat, enabled: draft.enabled,
      runAt: draft.repeat === 'once' || draft.repeat === 'interval' ? new Date(draft.runAt).toISOString() : null,
      intervalMinutes: draft.repeat === 'interval' ? minutes : null,
      time: draft.repeat === 'daily' || draft.repeat === 'weekly' ? draft.time : null,
      days: draft.repeat === 'weekly' ? draft.days : null,
    };
    setBusy('form'); setError('');
    const saved = await onSave(input, editing && editing !== 'new' ? editing.id : undefined);
    setBusy(null);
    if (saved) { setEditing(null); setDraft(null); } else setError('The schedule could not be saved.');
  }
  async function act(id: string, action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(id); await action(); setBusy(null);
  }
  const toggle = (schedule: OfficeSchedule) => act(schedule.id, () => onSave({ ...schedule, enabled: !schedule.enabled }, schedule.id));

  return <Modal close={close} busy={busy === 'form'} labelledBy="schedule-title">
    <div className="modal-title">
      <div><span className="eyebrow"><span /> {editing ? (editing === 'new' ? 'NEW SCHEDULE' : 'EDIT SCHEDULE') : 'AUTOMATIONS'}</span>
        <h2 id="schedule-title">{editing ? 'Schedule a task' : 'Scheduled tasks'} <b>✳</b></h2></div>
      <button type="button" onClick={close} disabled={busy === 'form'} aria-label="Close"><X size={19}/></button>
    </div>

    {!editing && <>
      <div className="schedule-filter" role="group" aria-label="Filter by agent">
        <button type="button" aria-pressed={!filter} className={!filter ? 'selected' : ''} onClick={() => setFilter(null)}>All agents</button>
        {agents.map(agent => <button type="button" key={agent.id} aria-pressed={filter === agent.id} className={filter === agent.id ? 'selected' : ''} onClick={() => setFilter(agent.id)}>
          <Avatar id={agent.id} size="sm"/>{agent.name}
        </button>)}
      </div>
      <ul className="schedule-list">
        {listed.map(schedule => {
          const agent = agents.find(item => item.id === schedule.agentId);
          const lastTask = schedule.lastTaskId ? tasks.find(task => task.id === schedule.lastTaskId) : undefined;
          return <li key={schedule.id} className={schedule.enabled ? '' : 'paused'} data-schedule={schedule.id}>
            <div className="schedule-main">
              <Avatar id={schedule.agentId} size="sm"/>
              <div>
                <strong>{schedule.title || schedule.prompt}</strong>
                {schedule.title && <p>{schedule.prompt}</p>}
                <span className="schedule-meta">{agent?.name ?? schedule.agentId} · {describeRepeat(schedule)}{schedule.repeat === 'once' && schedule.runAt ? ` · ${formatScheduleTime(schedule.runAt)}` : ''}</span>
              </div>
              <label className="schedule-switch" title={schedule.enabled ? 'Pause schedule' : 'Resume schedule'}>
                <input type="checkbox" checked={schedule.enabled} disabled={!connected || Boolean(busy)} onChange={() => void toggle(schedule)}
                  aria-label={`${schedule.enabled ? 'Pause' : 'Resume'} ${schedule.title || 'schedule'}`}/>
                <span/>
              </label>
            </div>
            <div className="schedule-status">
              <span className={schedule.enabled && schedule.nextRunAt ? 'next on' : 'next'}>
                <CalendarClock size={13}/>{schedule.enabled && schedule.nextRunAt ? `Next: ${formatScheduleTime(schedule.nextRunAt)} (${formatUntil(schedule.nextRunAt)})`
                  : schedule.repeat === 'once' && schedule.lastRunAt ? 'Finished' : 'Paused'}
              </span>
              {schedule.lastStatus && <span className={`last ${schedule.lastStatus}`} title={schedule.lastMessage || undefined}>
                {schedule.lastStatus === 'waiting' ? `Waiting: ${schedule.lastMessage}` : schedule.lastStatus === 'failed' ? `Last run failed: ${schedule.lastMessage}`
                  : `Last run ${formatScheduleTime(schedule.lastRunAt)}`}
              </span>}
              {lastTask && <button type="button" className="link-btn" onClick={() => onShowTask(lastTask.agentId, lastTask.id)}>View last task</button>}
            </div>
            <div className="schedule-actions">
              <button type="button" disabled={!connected || Boolean(busy)} onClick={() => void act(schedule.id, () => onRun(schedule.id))}><Play size={13}/>Run now</button>
              <button type="button" disabled={!connected || Boolean(busy)} onClick={() => openForm(schedule)}><Pencil size={13}/>Edit</button>
              <button type="button" className="danger" disabled={!connected || Boolean(busy)} onClick={() => { if (window.confirm('Delete this schedule?')) void act(schedule.id, () => onDelete(schedule.id)); }}><Trash2 size={13}/>Delete</button>
            </div>
          </li>;
        })}
        {!listed.length && <li className="schedule-empty"><CalendarClock size={28}/><strong>No scheduled tasks yet</strong><p>Schedule a task to run once, on a repeat, or at set times each day or week.</p></li>}
      </ul>
      <div className="modal-bottom">
        <span><CalendarClock size={15}/>{demo ? 'Preview only · scheduled runs are simulated' : 'Runs while Agent Office is open · times use this computer’s clock'}</span>
        <button type="button" className="primary-btn" data-autofocus disabled={!agents.length || !connected} onClick={() => openForm('new')}><Plus size={17}/>New schedule</button>
      </div>
    </>}

    {editing && draft && <form onSubmit={submit} className="schedule-form">
      <fieldset disabled={busy === 'form'}>
        <label htmlFor="schedule-prompt">WHAT SHOULD THE AGENT DO?</label>
        <textarea id="schedule-prompt" data-autofocus rows={4} maxLength={10000} required value={draft.prompt} onChange={event => update({ prompt: event.target.value })}
          placeholder="Example: Run the test suite and fix any failing tests..."/>
        <label htmlFor="schedule-name">NAME (OPTIONAL)</label>
        <input id="schedule-name" maxLength={80} value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="Nightly test run"/>
        <span id="schedule-assign" className="field-label">ASSIGN TO</span>
        <div className="modal-agent-list" role="group" aria-labelledby="schedule-assign">
          {agents.map(agent => <button type="button" key={agent.id} aria-pressed={draft.agentId === agent.id} className={draft.agentId === agent.id ? 'selected' : ''} onClick={() => update({ agentId: agent.id })}>
            <Avatar id={agent.id} size="sm"/>{agent.name}{draft.agentId === agent.id && <Check size={14}/>}
          </button>)}
        </div>
        <div className="schedule-grid">
          <div>
            <label htmlFor="schedule-repeat">REPEAT</label>
            <select id="schedule-repeat" className="language-picker" value={draft.repeat} onChange={event => update({ repeat: event.target.value as ScheduleRepeat })}>
              <option value="once">Once</option>
              <option value="interval">Every few minutes / hours / days</option>
              <option value="daily">Every day</option>
              <option value="weekly">On selected weekdays</option>
            </select>
          </div>
          {(draft.repeat === 'once' || draft.repeat === 'interval') && <div>
            <label htmlFor="schedule-run-at">{draft.repeat === 'once' ? 'RUN AT' : 'STARTING'}</label>
            <input id="schedule-run-at" type="datetime-local" required value={draft.runAt} onChange={event => update({ runAt: event.target.value })}/>
          </div>}
          {(draft.repeat === 'daily' || draft.repeat === 'weekly') && <div>
            <label htmlFor="schedule-time">TIME</label>
            <input id="schedule-time" type="time" required value={draft.time} onChange={event => update({ time: event.target.value })}/>
          </div>}
        </div>
        {draft.repeat === 'interval' && <div className="schedule-grid">
          <div>
            <label htmlFor="schedule-every">EVERY</label>
            <input id="schedule-every" type="number" min={1} max={10080} step={1} required value={draft.intervalValue} onChange={event => update({ intervalValue: Number(event.target.value) })}/>
          </div>
          <div>
            <label htmlFor="schedule-unit">UNIT</label>
            <select id="schedule-unit" className="language-picker" value={draft.intervalUnit} onChange={event => update({ intervalUnit: event.target.value as Unit })}>
              <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option>
            </select>
          </div>
        </div>}
        {draft.repeat === 'weekly' && <>
          <span id="schedule-days" className="field-label">ON</span>
          <div className="schedule-days" role="group" aria-labelledby="schedule-days">
            {WEEKDAYS.map((day, index) => <button type="button" key={day} aria-pressed={draft.days.includes(index)} className={draft.days.includes(index) ? 'selected' : ''}
              onClick={() => update({ days: draft.days.includes(index) ? draft.days.filter(item => item !== index) : [...draft.days, index].sort() })}>{day}</button>)}
          </div>
        </>}
        <label htmlFor="schedule-provider">AI PROVIDER</label>
        <select id="schedule-provider" className="language-picker" value={draft.provider} onChange={event => update({ provider: event.target.value as ProviderId, permissionMode: 'restricted' })}>
          {options.map(item => <option key={item.id} value={item.id}>{item.name}{!demo && !item.available ? ' (not found)' : ''}</option>)}
        </select>
        {!demo && <>
          <label htmlFor="schedule-permissions">AGENT PERMISSIONS</label>
          <select id="schedule-permissions" className="language-picker" value={draft.permissionMode} onChange={event => update({ permissionMode: event.target.value as PermissionMode })}>
            <option value="restricted">Restricted</option>
            <option value="approve-for-me" disabled={draft.provider === 'gemini'}>Approve for me</option>
            <option value="full-access">Full Access</option>
          </select>
          {draft.permissionMode === 'full-access' && <p className="mission-permissions-help">Every scheduled run can edit files outside the project and run commands with your account permissions, without anyone watching.</p>}
          <label htmlFor="schedule-dir">PROJECT DIRECTORY</label>
          <input id="schedule-dir" maxLength={1000} required value={draft.workspace} onChange={event => update({ workspace: event.target.value })} placeholder="Absolute project path"/>
        </>}
        <label className="schedule-enabled"><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })}/> Enabled</label>
      </fieldset>
      {formError && <p className="form-error" role="status">{formError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-bottom">
        <button type="button" className="office-reset" onClick={() => { setEditing(null); setDraft(null); }} disabled={busy === 'form'}><ArrowLeft size={13}/> Back to schedules</button>
        <button type="submit" className="primary-btn" disabled={Boolean(formError) || busy === 'form'}>{busy === 'form' ? 'Saving...' : 'Save schedule'} <Check size={17}/></button>
      </div>
    </form>}
  </Modal>;
}
