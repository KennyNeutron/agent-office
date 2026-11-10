import { BrainCircuit, Code2, Layers3, ShieldCheck, Network, Library, Users, Database, LockKeyhole } from 'lucide-react';
import type { OfficeTask, TaskPhase } from '../types';

export const statusName: Record<string, string> = { running: 'In progress', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', idle: 'Available' };
export const phaseName: Record<TaskPhase, string> = { thinking: 'Thinking', coding: 'Coding', researching: 'Researching', finishing: 'Finishing', idle: 'Idle' };
export const bundledDemoIds = new Set(['demo-nova', 'demo-atlas', 'demo-sentinel']);
export function displayPrompt(task: OfficeTask, translate: (text: string) => string): string {
    return bundledDemoIds.has(task.id) ? translate(task.prompt) : task.prompt;
}
/** Display name for a task's provider, including the retired Gemini CLI. */
export function providerName(provider: string | undefined, short = false): string {
  return provider === 'claude' ? (short ? 'Claude' : 'Claude Code')
    : provider === 'antigravity' ? (short ? 'Antigravity' : 'Antigravity CLI')
    : provider === 'gemini' ? (short ? 'Gemini' : 'Gemini CLI')
    : short ? 'Codex' : 'Codex CLI'
}

// Older task history stores the original runner text. Translate the event
// labels while preserving provider replies and command text verbatim.
const legacyEventPrefixes = [
    ['Tarefa enviada ao ', 'Task sent to '],
    ['Agente respondeu: ', 'Agent replied: '],
    ['Claude respondeu: ', 'Claude replied: '],
    ['Gemini respondeu: ', 'Gemini replied: '],
    ['Claude usou ', 'Claude used '],
    ['Gemini usou ', 'Gemini used '],
    ['Iniciando comando: ', 'Starting command: '],
    ['Concluiu comando: ', 'Finished command: '],
    ['Falha: ', 'Failed: '],
] as const;
const legacyEventLabels = new Map([
    ['Tarefa concluída.', 'Task completed.'],
    ['Tarefa cancelada.', 'Task cancelled.'],
    ['Cancelamento solicitado.', 'Cancellation requested.'],
    ['Codex iniciou a execução.', 'Codex started the task.'],
    ['Iniciando alteração de arquivos.', 'Starting file changes.'],
    ['Concluiu alteração de arquivos.', 'Finished file changes.'],
    ['Iniciando pesquisa na web.', 'Starting web search.'],
    ['Concluiu pesquisa na web.', 'Finished web search.'],
]);
export function displayEvent(task: OfficeTask, message: string, translate: (text: string) => string): string {
    if (task.id.startsWith('demo-')) return translate(message);
    const prefix = legacyEventPrefixes.find(([label]) => message.startsWith(label));
    if (prefix) return prefix[1] + message.slice(prefix[0].length);
    return legacyEventLabels.get(message) ?? message;
}
export const icons = { architecture: BrainCircuit, engineering: Code2, design: Layers3, quality: ShieldCheck, research: Library, operations: Network, security: LockKeyhole, data: Database, general: Users };
