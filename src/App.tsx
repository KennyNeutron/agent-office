import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Command, Info, Moon, Sun, Wifi, WifiOff, X } from 'lucide-react';
import { demoTasks, type AgentId, type OfficeAgent, type OfficeSchedule, type OfficeTask, type PermissionMode, type ProviderId, type ScheduleInput, type ServerState } from './types';
import { AgentsContext } from './agents';
import { useLanguage } from './locales/i18n';
import type { View } from './views/types';
import { Dot } from './components/Avatar';
import { Sidebar } from './components/Sidebar';
import { NewTask } from './components/NewTask';
import { ScheduleManager } from './components/ScheduleManager';
import { isDue, makeSchedule, recordRun, staleOnceSchedule, validStoredSchedules, validateSchedule } from '../server/schedules.mjs';
import { isAbsoluteWorkspace, isOfficeTask, isServerState, readResponse } from './components/dataFlow';
import { bundledDemoIds } from './components/taskDisplay';
import { Studio } from './views/Studio';
import { TaskList } from './views/Tasks';
import { Team } from './views/Team';
import { Settings } from './views/Settings';
import { OfficePreferencesContext } from './scene/OfficePreferencesContext';
import { loadOfficePreferences, normalizeOfficePreferences, OFFICE_PREFERENCES_KEY } from './scene/officePreferences';
import { loadDemoRoster, makeDemoAgent, saveDemoRoster, validateDemoAgent } from './demo/roster';

const PUBLIC_DEMO = import.meta.env.MODE === 'public-demo';
const EMPTY_AGENTS: OfficeAgent[] = [];
type Toast = { message: string; kind: 'success' | 'error' | 'info' };

const DEMO_HISTORY_KEY = 'agent-office-demo-history';
const DEMO_HISTORY_LIMIT = 100;
const DEMO_SCHEDULES_KEY = 'agent-office-demo-schedules';

function loadDemoSchedules(): OfficeSchedule[] {
  try {
    const saved: unknown = JSON.parse(readPreference(DEMO_SCHEDULES_KEY) || '[]');
    return validStoredSchedules(saved) ? saved : [];
  } catch { return []; }
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage disabled or full. */ }
}

function loadDemoHistory(): OfficeTask[] {
  const samples = demoTasks();
  try {
    const saved: unknown = JSON.parse(readPreference(DEMO_HISTORY_KEY) || '[]');
    if (Array.isArray(saved)) {
      const ids = new Set(bundledDemoIds);
      const completed = saved.filter((task): task is OfficeTask => {
        if (!isOfficeTask(task) || task.status !== 'completed' || !task.id.startsWith('demo-') || ids.has(task.id)) return false;
        ids.add(task.id);
        return true;
      });
      return [...completed.slice(0, DEMO_HISTORY_LIMIT), ...samples];
    }
  } catch { /* Invalid saved history. */ }
  return samples;
}

export default function App() {
  const { t: tr, formatTime } = useLanguage();
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('agent-office-theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.uiTheme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    try { localStorage.setItem('agent-office-theme', next ? 'dark' : 'light'); } catch { /* Storage disabled */ }
  }

  const [view, setView] = useState<View>('studio');
  const [selected, setSelected] = useState<AgentId>(() => readPreference('agent-office-selected-agent') || 'nova');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [demo, setDemo] = useState(() => PUBLIC_DEMO || readPreference('agent-office-mode') !== 'live');
  const [demoData, setDemoData] = useState(loadDemoHistory);
  const [server, setServer] = useState<ServerState | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(!PUBLIC_DEMO);
  const [stateError, setStateError] = useState(false);
  const [demoRoster, setDemoRoster] = useState<OfficeAgent[]>(loadDemoRoster);
  const [demoSchedules, setDemoSchedules] = useState<OfficeSchedule[]>(loadDemoSchedules);
  const [scheduleModal, setScheduleModal] = useState<{ agentId: AgentId | null } | null>(null);
  const [savedWorkspace] = useState(() => readPreference('agent-office-workspace'));
  const [workspace, setWorkspace] = useState(savedWorkspace ?? '');
  const [officePreferences, setOfficePreferences] = useState(loadOfficePreferences);
  const [provider, setProvider] = useState<ProviderId>(() => {
    try { const stored = localStorage.getItem('agent-office-provider'); if (stored === 'claude' || stored === 'gemini') return stored; } catch { /* Storage disabled */ }
    return 'codex';
  });
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(() => new Date());
  const toastTimer = useRef<number | undefined>(undefined);
  const demoTimers = useRef<number[]>([]);
  const starting = useRef(false);
  const mutations = useRef(new Set<string>());
  const mounted = useRef(false);
  const snapshotVersion = useRef(0);
  const pendingState = useRef<AbortController | null>(null);
  const workspaceTouched = useRef(savedWorkspace !== null);
  const agents = demo ? demoRoster : server?.agents ?? EMPTY_AGENTS;
  // Created-task history survives agent removal; bundled samples belong to the sample crew only.
  const tasks = useMemo(() => demo ? demoData.filter(task => !bundledDemoIds.has(task.id) || agents.some(agent => agent.id === task.agentId)) : server?.tasks ?? [], [demo, demoData, server, agents]);
  const schedules = useMemo(() => demo ? demoSchedules.filter(item => agents.some(agent => agent.id === item.agentId)) : server?.schedules ?? [], [demo, demoSchedules, server, agents]);
  const resolvedSelected = agents.some(agent => agent.id === selected) ? selected : agents[0]?.id ?? '';
  const inspectedAgent = tasks.find(task => task.id === selectedTask)?.agentId ?? resolvedSelected;
  const cliReady = Boolean(online && server?.providers.some(item => item.available));

  function updateOfficePreferences(update: Partial<typeof officePreferences>) {
    setOfficePreferences(current => {
      const next = normalizeOfficePreferences({ ...current, ...update });
      try { localStorage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* Storage disabled */ }
      return next;
    });
  }
  function notice(message: string, kind: Toast['kind'] = 'success') {
    window.clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }
  function chooseProvider(value: ProviderId) {
    setProvider(value); setTaskError('');
    try { localStorage.setItem('agent-office-provider', value); } catch { /* Storage disabled */ }
  }
  function selectAgent(id: AgentId) {
    setSelected(id); setSelectedTask(null); setTaskError('');
    savePreference('agent-office-selected-agent', id);
  }
  function editWorkspace(value: string) {
    workspaceTouched.current = true;
    setWorkspace(value); setTaskError('');
    savePreference('agent-office-workspace', value);
  }
  function changeMode(value: boolean) {
    if (PUBLIC_DEMO || starting.current) return;
    setDemo(value); setSelectedTask(null); setModal(false); setScheduleModal(null); setTaskError('');
    savePreference('agent-office-mode', value ? 'demo' : 'live');
    notice(tr(value ? 'Showing demo preview' : 'Showing real AI events'), 'info');
  }
  const acceptState = useCallback((data: unknown) => {
    if (!isServerState(data)) throw new Error('Invalid state');
    snapshotVersion.current++;
    setServer(data); setOnline(data.connected); setLoading(false); setStateError(!data.connected);
    if (!workspaceTouched.current) setWorkspace(data.defaultWorkspace);
  }, []);
  const reloadState = useCallback(async () => {
    pendingState.current?.abort();
    const controller = new AbortController();
    pendingState.current = controller;
    const version = snapshotVersion.current;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/state', { signal: controller.signal });
      if (!response.ok) throw new Error('State unavailable');
      const data: unknown = await response.json();
      // Stream updates and disconnects supersede the HTTP request that preceded them.
      if (mounted.current && pendingState.current === controller && version === snapshotVersion.current) acceptState(data);
    } catch {
      if (mounted.current && pendingState.current === controller && version === snapshotVersion.current) {
        setOnline(false); setStateError(true);
      }
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && pendingState.current === controller) setLoading(false);
    }
  }, [acceptState]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const previewTimers = demoTimers.current;
    let stream: EventSource | undefined;
    if (!PUBLIC_DEMO) {
      // Skip the StrictMode probe mount before opening its initial HTTP request.
      queueMicrotask(() => { if (active) void reloadState(); });
      stream = new EventSource('/api/events');
      stream.addEventListener('state', event => {
        if (!active) return;
        try { acceptState(JSON.parse((event as MessageEvent).data)); }
        catch { snapshotVersion.current++; setStateError(true); setOnline(false); setLoading(false); }
      });
      stream.onerror = () => {
        if (!active) return;
        snapshotVersion.current++; setOnline(false); setStateError(true); setLoading(false);
      };
    }
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => {
      mounted.current = false;
      active = false;
      pendingState.current?.abort(); stream?.close(); window.clearInterval(timer);
      window.clearTimeout(toastTimer.current);
      previewTimers.forEach(window.clearTimeout);
    };
  }, [acceptState, reloadState]);
  useEffect(() => { saveDemoRoster(demoRoster); }, [demoRoster]);
  useEffect(() => { savePreference(DEMO_SCHEDULES_KEY, JSON.stringify(demoSchedules)); }, [demoSchedules]);
  useEffect(() => {
    const completed = demoData.filter(task => task.status === 'completed' && !bundledDemoIds.has(task.id));
    savePreference(DEMO_HISTORY_KEY, JSON.stringify(completed.slice(0, DEMO_HISTORY_LIMIT)));
  }, [demoData]);

  function showNew(agent?: AgentId) {
    if (!agents.length) { setView('team'); notice(tr('Add an agent to create tasks'), 'info'); return; }
    selectAgent(agent || resolvedSelected); setModal(true);
  }
  // Simulated run used by Demo mode for both manual and scheduled tasks.
  function launchDemoTask(agentId: AgentId, prompt: string, providerId: ProviderId, schedule?: OfficeSchedule): string {
    const id = 'demo-' + crypto.randomUUID(), stamp = new Date().toISOString();
    const events = [{ id: id + 'e', at: stamp, kind: 'info', message: 'Preview started. No code is executed.' }];
    if (schedule) events.unshift({ id: id + 's', at: stamp, kind: 'info', message: `Started by schedule "${(schedule.title || schedule.prompt).slice(0, 60)}".` });
    const task: OfficeTask = { id, prompt, agentId, agentName: agents.find(agent => agent.id === agentId)?.name, provider: providerId, workspace: 'Demo workspace', status: 'running', phase: 'thinking', createdAt: stamp, updatedAt: stamp, finishedAt: null, lastMessage: '', threadId: null, events, scheduleId: schedule?.id ?? null };
    setDemoData(value => [task, ...value]);
    const advance = (complete: boolean) => setDemoData(value => value.map(item => {
      if (item.id !== id || item.status !== 'running') return item;
      const at = new Date().toISOString();
      return { ...item, phase: complete ? 'idle' : 'coding', status: complete ? 'completed' : 'running', updatedAt: at, finishedAt: complete ? at : null,
        events: [...item.events, { id: id + (complete ? 'g' : 'f'), at, kind: complete ? 'success' : 'info', message: complete ? 'Preview task completed.' : 'Simulating agent activity...' }] };
    }));
    demoTimers.current.push(window.setTimeout(() => advance(false), 2000), window.setTimeout(() => advance(true), 7000));
    return id;
  }
  async function start(prompt: string, permissionMode: PermissionMode) {
    if (starting.current || !prompt.trim() || prompt.length > 10000 || !agents.some(agent => agent.id === resolvedSelected)) return;
    const blocked = !demo && (!online ? 'API OFFLINE' : !server?.providers.some(item => item.id === provider && item.available) ? 'Choose an available AI provider.'
      : tasks.some(task => task.agentId === resolvedSelected && task.status === 'running') ? 'Agent is already working.'
      : !isAbsoluteWorkspace(workspace) ? 'Enter an absolute project path.' : '');
    if (blocked) { setTaskError(tr(blocked)); return; }
    starting.current = true; setBusy(true); setTaskError('');
    try {
      if (demo) {
        setSelectedTask(launchDemoTask(resolvedSelected, prompt.trim(), provider));
        notice(tr('Demo task started · preview only'));
      } else {
        let response: Response;
        try {
          response = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: resolvedSelected, provider, prompt: prompt.trim(), workspace, permissionMode }), signal: AbortSignal.timeout(15000) });
        } catch { throw new Error(tr('No confirmation received. Check task history before trying again.')); }
        const result = await readResponse(response, tr(response.ok ? 'No confirmation received. Check task history before trying again.' : 'Could not start task'));
        if (!isOfficeTask(result.task) || result.task.agentId !== resolvedSelected) throw new Error(tr('No confirmation received. Check task history before trying again.'));
        const task = result.task;
        if (!mounted.current) return;
        // Keep a newer streamed version, but display a newly acknowledged task immediately.
        setServer(value => value && ({ ...value, tasks: value.tasks.some(item => item.id === task.id) ? value.tasks : [task, ...value.tasks] }));
        setSelectedTask(task.id);
        notice((server?.providers.find(item => item.id === provider)?.name || provider) + ' · ' + tr('Task started'));
      }
      setModal(false); setView('studio');
    } catch (error) {
      if (mounted.current) setTaskError(error instanceof Error ? error.message : tr('Could not start task'));
    } finally { starting.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel(id: string) {
    if (!tasks.some(task => task.id === id && task.status === 'running') || mutations.current.has(id)) return;
    if (demo) {
      const at = new Date().toISOString();
      setDemoData(value => value.map(task => task.id === id && task.status === 'running' ? { ...task, status: 'cancelled', phase: 'idle', finishedAt: at, updatedAt: at,
        events: [...task.events, { id: crypto.randomUUID(), at, kind: 'info', message: 'Preview stopped' }] } : task));
      notice(tr('Preview stopped')); return;
    }
    if (!online) { notice(tr('API OFFLINE'), 'error'); return; }
    mutations.current.add(id);
    try {
      const response = await fetch('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST', signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, tr('Cancellation failed'));
      if (result.ok !== true) throw new Error(tr('Cancellation failed'));
      notice(tr('Cancellation requested'), 'info'); void reloadState();
    } catch (error) { notice(error instanceof Error ? error.message : tr('Cancellation failed'), 'error'); }
    finally { mutations.current.delete(id); }
  }
  async function saveAgent(input: Omit<OfficeAgent, 'id' | 'short'>, id?: string) {
    if (demo) {
      const agent = makeDemoAgent(input, id);
      if (!validateDemoAgent(agent) || (id && !agents.some(item => item.id === id))) { notice(tr('Invalid agent details'), 'error'); return false; }
      if (!id && demoRoster.length >= 1000) { notice(tr('Preview is limited to 1000 agents'), 'error'); return false; }
      setDemoRoster(current => id ? current.map(item => item.id === id ? agent : item) : [...current, agent]);
      selectAgent(agent.id); notice(tr(id ? 'Agent updated' : 'Agent created')); return true;
    }
    if (!online) { notice(tr('API OFFLINE'), 'error'); return false; }
    const version = snapshotVersion.current;
    try {
      const response = await fetch(id ? '/api/agents/' + encodeURIComponent(id) : '/api/agents', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, tr('Unable to save agent'));
      if (!validateDemoAgent(result.agent) || (id && result.agent.id !== id)) throw new Error(tr('Unable to save agent'));
      const agent = result.agent;
      // A delayed response must neither overwrite a newer streamed edit nor resurrect a removed agent.
      if (version === snapshotVersion.current) setServer(value => value && ({ ...value, agents: value.agents.some(item => item.id === agent.id)
        ? value.agents.map(item => item.id === agent.id ? agent : item) : [...value.agents, agent] }));
      selectAgent(agent.id); notice(tr(id ? 'Agent updated' : 'Agent created')); return true;
    } catch (error) { notice(error instanceof Error ? error.message : tr('Unable to save agent'), 'error'); return false; }
  }
  async function deleteAgent(id: string) {
    if (tasks.some(task => task.agentId === id && task.status === 'running')) { notice(tr('Agent is already working.'), 'error'); return false; }
    if (demo) { setDemoRoster(current => current.filter(item => item.id !== id)); setDemoSchedules(current => current.filter(item => item.agentId !== id)); }
    else {
      if (!online) { notice(tr('API OFFLINE'), 'error'); return false; }
      try {
        const response = await fetch('/api/agents/' + encodeURIComponent(id), { method: 'DELETE', signal: AbortSignal.timeout(15000) });
        const result = await readResponse(response, tr('Unable to remove agent'));
        if (result.ok !== true) throw new Error(tr('Unable to remove agent'));
        setServer(value => value && ({ ...value, agents: value.agents.filter(item => item.id !== id) }));
      } catch (error) { notice(error instanceof Error ? error.message : tr('Unable to remove agent'), 'error'); return false; }
    }
    if (id === selected) selectAgent(agents.find(item => item.id !== id)?.id || '');
    notice(tr('Agent removed')); return true;
  }
  function openSchedules(agentId: AgentId | null = null) {
    if (!agents.length) { setView('team'); notice(tr('Add an agent to create tasks'), 'info'); return; }
    setScheduleModal({ agentId });
  }
  async function saveSchedule(input: ScheduleInput, id?: string) {
    const label = id ? 'Schedule updated' : 'Schedule created';
    if (demo) {
      const previous = id ? demoSchedules.find(item => item.id === id) : undefined;
      const error = validateSchedule(input) || (id && !previous ? 'Schedule not found.' : staleOnceSchedule(input) ? 'Choose a time in the future.' : '');
      if (error) { notice(error, 'error'); return false; }
      const schedule = makeSchedule(input, id ?? 'demo-schedule-' + crypto.randomUUID(), new Date(), previous);
      setDemoSchedules(current => id ? current.map(item => item.id === id ? schedule : item) : [...current, schedule]);
      notice(label); return true;
    }
    if (!online) { notice(tr('API OFFLINE'), 'error'); return false; }
    const version = snapshotVersion.current;
    try {
      const response = await fetch(id ? '/api/schedules/' + encodeURIComponent(id) : '/api/schedules', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, 'Unable to save schedule');
      const schedule = result.schedule as OfficeSchedule;
      if (!validStoredSchedules([schedule])) throw new Error('Unable to save schedule');
      if (version === snapshotVersion.current) setServer(value => value && ({ ...value, schedules: (value.schedules ?? []).some(item => item.id === schedule.id)
        ? (value.schedules ?? []).map(item => item.id === schedule.id ? schedule : item) : [...(value.schedules ?? []), schedule] }));
      notice(label); return true;
    } catch (error) { notice(error instanceof Error ? error.message : 'Unable to save schedule', 'error'); return false; }
  }
  async function deleteSchedule(id: string) {
    if (demo) { setDemoSchedules(current => current.filter(item => item.id !== id)); notice('Schedule deleted'); return true; }
    if (!online) { notice(tr('API OFFLINE'), 'error'); return false; }
    try {
      const response = await fetch('/api/schedules/' + encodeURIComponent(id), { method: 'DELETE', signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, 'Unable to delete schedule');
      if (result.ok !== true) throw new Error('Unable to delete schedule');
      setServer(value => value && ({ ...value, schedules: (value.schedules ?? []).filter(item => item.id !== id) }));
      notice('Schedule deleted'); return true;
    } catch (error) { notice(error instanceof Error ? error.message : 'Unable to delete schedule', 'error'); return false; }
  }
  async function runSchedule(id: string) {
    const schedule = schedules.find(item => item.id === id);
    if (!schedule) return false;
    if (demo) {
      if (tasks.some(task => task.agentId === schedule.agentId && task.status === 'running' && !bundledDemoIds.has(task.id))) { notice(tr('Agent is already working.'), 'error'); return false; }
      const taskId = launchDemoTask(schedule.agentId, schedule.prompt, schedule.provider, schedule);
      setDemoSchedules(current => current.map(item => item.id !== id ? item : item.repeat === 'once' ? recordRun(item, { status: 'launched', taskId })
        : { ...item, lastRunAt: new Date().toISOString(), lastTaskId: taskId, lastStatus: 'launched', lastMessage: '' }));
      notice('Scheduled task started · preview only'); return true;
    }
    if (!online) { notice(tr('API OFFLINE'), 'error'); return false; }
    try {
      const response = await fetch('/api/schedules/' + encodeURIComponent(id) + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, tr('Could not start task'));
      if (!isOfficeTask(result.task)) throw new Error(tr('Could not start task'));
      const task = result.task;
      setServer(value => value && ({ ...value, tasks: value.tasks.some(item => item.id === task.id) ? value.tasks : [task, ...value.tasks] }));
      notice('Scheduled task started'); return true;
    } catch (error) { notice(error instanceof Error ? error.message : tr('Could not start task'), 'error'); return false; }
  }
  // Demo mode simulates the API scheduler in the browser while the page is open.
  const demoScheduler = useRef({ demo, demoSchedules, tasks, launch: launchDemoTask });
  useEffect(() => { demoScheduler.current = { demo, demoSchedules, tasks, launch: launchDemoTask }; });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { demo: active, demoSchedules: list, tasks: current, launch } = demoScheduler.current;
      if (!active) return;
      const updates = new Map<string, OfficeSchedule>();
      // Bundled sample tasks never finish, so only tasks started in this preview count as busy.
      const busy = new Set(current.filter(task => task.status === 'running' && !bundledDemoIds.has(task.id)).map(task => task.agentId));
      for (const schedule of list.filter(item => isDue(item))) {
        if (busy.has(schedule.agentId)) {
          if (schedule.lastStatus !== 'waiting') updates.set(schedule.id, recordRun(schedule, { status: 'waiting', message: 'Agent is already working.' }));
          continue;
        }
        busy.add(schedule.agentId);
        updates.set(schedule.id, recordRun(schedule, { status: 'launched', taskId: launch(schedule.agentId, schedule.prompt, schedule.provider, schedule) }));
      }
      if (updates.size) setDemoSchedules(value => value.map(item => updates.get(item.id) ?? item));
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  const ToastIcon = toast?.kind === 'error' ? AlertCircle : toast?.kind === 'info' ? Info : CheckCircle2;
  return <OfficePreferencesContext.Provider value={{ preferences: officePreferences, updatePreferences: updateOfficePreferences }}><AgentsContext.Provider value={agents}>
    <div className="shell">
      <a className="skip-link" href="#main-content">{tr('Skip to content')}</a>
      <Sidebar view={view} setView={setView} onNew={() => showNew()}/>
      <div className="app-main">
        <header className="topbar"><div className="crumb"><span><Command size={15}/></span>{' ' + tr('My workspace') + ' '}<b>/</b><strong>{tr(view === 'studio' ? 'Office studio' : view === 'tasks' ? 'Activity & tasks' : view === 'team' ? 'Agent team' : 'Settings')}</strong><ChevronDown size={13}/></div>
          <div className="topbar-actions"><time>{formatTime(now)}</time><i/>{PUBLIC_DEMO ? <span className="api-badge on"><Wifi size={14}/>{tr('Demo environment')}</span> : <span className={cliReady ? 'api-badge on' : 'api-badge'}>{cliReady ? <Wifi size={14}/> : <WifiOff size={14}/>} {tr(cliReady ? 'READY' : online ? 'NOT FOUND' : 'API OFFLINE')}</span>}
            {PUBLIC_DEMO ? <span className="mode-btn demo"><Dot status="amber"/>{tr('DEMO MODE')}</span> : <button className={demo ? 'mode-btn demo' : 'mode-btn live'} aria-pressed={demo} onClick={() => changeMode(!demo)}><Dot status={demo ? 'amber' : online ? 'running' : 'failed'}/>{tr(demo ? 'DEMO MODE' : 'LIVE MODE')} <ChevronDown size={13}/></button>}
            <button type="button" className="theme-toggle" aria-label={tr('Dark mode')} aria-pressed={darkMode} title={tr('Dark mode')} onClick={toggleTheme}>
              {darkMode ? <Sun size={16} aria-hidden="true"/> : <Moon size={16} aria-hidden="true"/>}
            </button>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {!demo && (loading || stateError || !online) && <div className="connection-message" role={stateError ? 'alert' : 'status'}>
            <span>{tr(loading ? 'Loading workspace…' : server ? 'Showing saved activity; the API is offline.' : 'Unable to load workspace')}</span>
            {!loading && <button type="button" onClick={() => { setLoading(true); void reloadState(); }}>{tr('Retry')}</button>}
          </div>}
          {view === 'studio' && <Studio tasks={tasks} schedules={schedules} onSchedules={openSchedules} selected={inspectedAgent} setSelected={selectAgent} selectedTask={selectedTask} setSelectedTask={setSelectedTask} onNew={() => showNew()} demo={demo} ready={cliReady}/>}
          {view === 'tasks' && <TaskList tasks={tasks} onSelect={(id, taskId) => { setSelected(id); setSelectedTask(taskId); setView('studio'); }} cancel={cancel} canCancel={demo || online}/>}
          {view === 'team' && <Team tasks={tasks} onTask={showNew} onSave={saveAgent} onDelete={deleteAgent} connected={demo || online} demo={demo}/>}
          {view === 'settings' && <Settings workspace={workspace} setWorkspace={editWorkspace} demo={demo} setDemo={changeMode} server={server} online={online} publicPreview={PUBLIC_DEMO}/>}
        </main>
        <footer><span>© 2026 Agent Office <b>✳</b>{' ' + tr('Made for builders')}</span><span>v0.4.0 <i>·</i>{' ' + tr('Open source')}</span></footer>
      </div>
      {modal && agents.length > 0 && <NewTask agent={resolvedSelected} setAgent={selectAgent} provider={provider} setProvider={chooseProvider} providers={server?.providers || []} workspace={workspace} setWorkspace={editWorkspace} close={() => setModal(false)} start={start} busy={busy} demo={demo} online={online} agentBusy={tasks.some(task => task.agentId === resolvedSelected && task.status === 'running')} error={taskError}/>}
      {scheduleModal && agents.length > 0 && <ScheduleManager schedules={schedules} tasks={tasks} initialAgent={scheduleModal.agentId} providers={server?.providers || []} defaultProvider={provider} workspace={workspace} demo={demo} online={online}
        close={() => setScheduleModal(null)} onSave={saveSchedule} onDelete={deleteSchedule} onRun={runSchedule}
        onShowTask={(agentId, taskId) => { setScheduleModal(null); setSelected(agentId); setSelectedTask(taskId); setView('studio'); }}/>}
      {toast && <div className={'toast toast-' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}><ToastIcon size={17}/>{toast.message}<button onClick={() => { window.clearTimeout(toastTimer.current); setToast(null); }} aria-label={tr('Dismiss toast')}><X size={14}/></button></div>}
    </div>
  </AgentsContext.Provider></OfficePreferencesContext.Provider>;
}
