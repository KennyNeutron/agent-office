import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Clock3, Cpu, History, Timer } from 'lucide-react';
import { useLanguage } from '../locales/i18n';
import { displayEvent, displayPrompt, statusName, phaseName, providerName } from './taskDisplay';
import { Dot } from './Avatar';
import type { OfficeTask } from '../types';

function elapsedSeconds(task: OfficeTask, now: number) {
  const start = Date.parse(task.createdAt);
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

function durationText(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return (hours ? String(hours).padStart(2, '0') + ':' : '') +
    String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
}

export function ExecutionInspector({ task }: { task?: OfficeTask }) {
  const { t: tr, formatTime, locale } = useLanguage();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (task?.status !== 'running') return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);

  const events = task?.events ?? [];
  const ended = task?.status !== 'running';
  return <section className="execution-inspector" aria-label={tr('Execution inspector')}>
    <div className="execution-heading">
      <div><Activity size={16}/><h3>{tr('Execution inspector')}</h3></div>
      {task && <span className={`pill-status ${task.status}`}><Dot status={task.status}/>{tr(statusName[task.status])}</span>}
    </div>
    {!task ? <p className="execution-empty">{tr('No task assigned yet.')}</p> : <>
      <p className="execution-prompt"><strong>{providerName(task.provider)}</strong> · {displayPrompt(task, tr)}</p>
      <div className="execution-stats">
        <div><Cpu size={15}/><span>{tr('Current phase')}</span><strong>{tr(ended ? phaseName.idle : phaseName[task.phase])}</strong></div>
        <div><Timer size={15}/><span>{tr('Elapsed time')}</span><strong className="mono-numbers">{durationText(elapsedSeconds(task, now))}</strong></div>
        <div><Clock3 size={15}/><span>{tr('Last update')}</span><strong>{formatTime(task.updatedAt)}</strong></div>
      </div>
      <div className="execution-times"><span>{tr('Started')} · {formatTime(task.createdAt)}</span>{task.finishedAt && <span>{tr('Finished')} · {formatTime(task.finishedAt)}</span>}</div>
      {task.failure && <div className="execution-error" role="alert"><AlertCircle size={16}/><div><strong>{tr('Error details')}</strong><p>{task.failure}</p></div></div>}
      {task.usage && (task.usage.input_tokens != null || task.usage.output_tokens != null) && <div className="execution-usage">
        {task.usage.input_tokens != null && <span>{tr('Input tokens')}: <strong>{new Intl.NumberFormat(locale).format(task.usage.input_tokens)}</strong></span>}
        {task.usage.output_tokens != null && <span>{tr('Output tokens')}: <strong>{new Intl.NumberFormat(locale).format(task.usage.output_tokens)}</strong></span>}
      </div>}
      <div className="execution-log-title"><History size={15}/><h4>{tr('Activity timeline')}</h4><small>{events.length}</small></div>
      <ol className="execution-log">
        {events.length ? [...events].reverse().map(event => <li key={event.id} className={event.kind === 'error' ? 'event-error' : event.kind === 'success' ? 'event-success' : ''}>
          <span className="execution-marker" aria-hidden="true"/>
          <div><time dateTime={event.at}>{formatTime(event.at)}</time><p>{displayEvent(task, event.message, tr)}</p></div>
        </li>) : <li className="execution-no-events">{tr('No events recorded yet.')}</li>}
      </ol>
    </>}
  </section>;
}
