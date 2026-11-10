import { GitBranch } from 'lucide-react';
import type { OfficeTask } from '../types';
import { useAgent } from '../agents';
import { useLanguage } from '../locales/i18n';
import { Avatar, Dot } from './Avatar';
import { statusName, displayPrompt, providerName } from './taskDisplay';

export function TaskTile({ task, selected, onClick }: {
    task: OfficeTask;
    selected: boolean;
    onClick: () => void;
}) {
    const { t: tr, formatAgo } = useLanguage();
    const agent = useAgent(task.agentId);
    return <button aria-pressed={selected} className={`task-tile ${selected ? 'selected' : ''}`} onClick={onClick}><div className="task-tile-top"><span><Avatar id={task.agentId} size="sm"/>{task.agentName || agent?.name || task.agentId} · {providerName(task.provider, true)}</span><span className={`pill-status ${task.status}`}><Dot status={task.status}/>{tr(statusName[task.status])}</span></div><strong>{displayPrompt(task, tr)}</strong><div className="task-tile-bottom"><span><GitBranch size={12}/>{task.workspace === 'Demo workspace' ? tr('Demo workspace') : task.workspace.split(/[\\/]/).filter(Boolean).at(-1)}</span><time dateTime={task.updatedAt}>{formatAgo(task.updatedAt)}</time></div></button>;
}
