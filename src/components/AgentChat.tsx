import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eraser, Lock, Send, Square, X } from 'lucide-react';
import type { ChatMessage, ChatStatus, OfficeAgent, ProviderId, ProviderInfo } from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { readResponse } from './dataFlow';

const MAX_MESSAGE = 4000;
const PROVIDER_NAMES: Record<ProviderId, string> = { codex: 'Codex CLI', claude: 'Claude Code', antigravity: 'Antigravity CLI' };
// Demo conversations live only in this browser tab.
const demoChats = new Map<string, ChatMessage[]>();

const isChatMessage = (value: unknown): value is ChatMessage => {
  const item = value as ChatMessage;
  return Boolean(item) && typeof item.id === 'string' && (item.role === 'user' || item.role === 'agent') && typeof item.text === 'string' && typeof item.at === 'string';
};
const timeOf = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A conversation with one agent. Replies come from the agent's default provider and run read-only. */
export function AgentChat({ agent, status, providers, officeProvider, workspace, demo, online, close }: {
  agent: OfficeAgent;
  status: ChatStatus | undefined;
  providers: ProviderInfo[];
  /** Used when the agent has no default provider. */
  officeProvider: ProviderId;
  workspace: string;
  demo: boolean;
  online: boolean;
  close: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => demo ? demoChats.get(agent.id) ?? [] : []);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [demoPending, setDemoPending] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(demo);
  const list = useRef<HTMLOListElement>(null);
  const demoTimer = useRef<number | undefined>(undefined);
  const providerId = agent.provider || officeProvider;
  const provider = providers.find(item => item.id === providerId);
  const providerName = provider?.name ?? PROVIDER_NAMES[providerId];
  const pending = demo ? demoPending : Boolean(status?.pending);
  const unavailable = !demo && (!online ? 'API OFFLINE' : provider && !provider.available ? `${providerName} was not found. Install it or choose another default provider for ${agent.name}.` : '');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, { signal });
      const result = await readResponse(response, 'Could not load the conversation.');
      if (Array.isArray(result.messages)) setMessages(result.messages.filter(isChatMessage));
      setLoaded(true);
    } catch (reason) {
      if (!signal?.aborted) { setError(reason instanceof Error ? reason.message : 'Could not load the conversation.'); setLoaded(true); }
    }
  }, [agent.id]);
  // Refetch whenever the server reports a change to this agent's conversation.
  const version = status?.version ?? 0;
  useEffect(() => {
    if (demo || !online) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [demo, online, load, version]);
  useEffect(() => () => window.clearTimeout(demoTimer.current), []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, pending]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || pending || unavailable) return;
    setError('');
    if (demo) {
      const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', text, at: new Date().toISOString() };
      const next = [...messages, user];
      setMessages(next); demoChats.set(agent.id, next); setDraft(''); setDemoPending(true);
      demoTimer.current = window.setTimeout(() => {
        const reply: ChatMessage = { id: crypto.randomUUID(), role: 'agent', provider: providerId, at: new Date().toISOString(),
          text: `Hi, I'm ${agent.name} (${agent.role}). This is a preview, so no AI provider is called. In Live mode, ${providerName} would answer this message.` };
        setMessages(current => { const updated = [...current, reply]; demoChats.set(agent.id, updated); return updated; });
        setDemoPending(false);
      }, 1200);
      return;
    }
    setSending(true);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, workspace: workspace || undefined, provider: officeProvider }), signal: AbortSignal.timeout(15000) });
      const result = await readResponse(response, 'Could not send the message.');
      if (isChatMessage(result.message)) { const sent = result.message; setMessages(current => current.some(item => item.id === sent.id) ? current : [...current, sent]); }
      setDraft('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send the message.'); }
    finally { setSending(false); }
  }
  async function stop() {
    if (demo) { window.clearTimeout(demoTimer.current); setDemoPending(false); return; }
    try { await readResponse(await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), 'Could not stop the reply.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop the reply.'); }
  }
  async function clear() {
    if (pending || !window.confirm(`Clear your conversation with ${agent.name}?`)) return;
    if (demo) { setMessages([]); demoChats.delete(agent.id); return; }
    try {
      await readResponse(await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, { method: 'DELETE' }), 'Could not clear the conversation.');
      setMessages([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not clear the conversation.'); }
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };

  return <Modal close={close} labelledBy="agent-chat-title">
    <div className="modal-title chat-title">
      <div className="chat-who"><Avatar id={agent.id} size="sm"/><div>
        <h2 id="agent-chat-title">{agent.name}</h2>
        <span>{agent.role} · answers with {providerName}{agent.provider ? '' : ' (office default)'}</span>
      </div></div>
      <div className="chat-title-actions">
        <button type="button" onClick={() => void clear()} disabled={pending || !messages.length || (!demo && !online)} title="Clear conversation" aria-label="Clear conversation"><Eraser size={16}/></button>
        <button type="button" onClick={close} aria-label="Close"><X size={18}/></button>
      </div>
    </div>
    <ol className="chat-log" ref={list} aria-live="polite">
      {loaded && !messages.length && <li className="chat-empty">Say hello to {agent.name}. Ask about the project, get a second opinion, or talk through a plan before you assign a task.</li>}
      {messages.map(message => <li key={message.id} className={`chat-message ${message.role}${message.error ? ' error' : ''}`}>
        {message.role === 'agent' && <Avatar id={agent.id} size="sm"/>}
        <div><p>{message.text}</p><time dateTime={message.at}>{timeOf(message.at)}{message.role === 'agent' && message.provider ? ` · ${PROVIDER_NAMES[message.provider]}` : ''}</time></div>
      </li>)}
      {pending && <li className="chat-message agent typing"><Avatar id={agent.id} size="sm"/><div><p><span/><span/><span/></p><time>{agent.name} is thinking…</time></div></li>}
    </ol>
    <form className="chat-compose" onSubmit={send}>
      <textarea data-autofocus rows={2} maxLength={MAX_MESSAGE} value={draft} placeholder={`Message ${agent.name}…`} aria-label={`Message ${agent.name}`}
        onChange={event => setDraft(event.target.value)} onKeyDown={onKey} disabled={Boolean(unavailable)}/>
      {pending
        ? <button type="button" className="secondary-btn" onClick={() => void stop()}><Square size={14}/>Stop</button>
        : <button type="submit" className="primary-btn" disabled={!draft.trim() || sending || Boolean(unavailable)}><Send size={15}/>{sending ? 'Sending…' : 'Send'}</button>}
    </form>
    {(unavailable || error) && <p className="form-error" role="alert">{unavailable || error}</p>}
    <p className="chat-note"><Lock size={12}/>{demo ? 'Preview only · no AI provider is called' : 'Read-only: the agent can read your project to answer but cannot change files. Assign a task for changes.'}</p>
  </Modal>;
}
