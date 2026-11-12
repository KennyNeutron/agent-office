import { useState, type FormEvent } from 'react';
import { Check, FolderOpen, History, RotateCcw, X } from 'lucide-react';
import type { OfficeSettings } from '../types';
import { Modal } from './Modal';
import { folderName, isAbsoluteWorkspace } from './dataFlow';

/**
 * Sets the office-wide project folder. Tasks, schedules and chats use it unless
 * one names another folder. `save(null)` returns to the folder the office was launched from.
 */
export function ProjectForm({ office, current, save, forget, online, autoFocus = false, onSaved }: {
  office: OfficeSettings | undefined;
  current: string;
  save: (path: string | null) => Promise<boolean>;
  forget: (path: string) => Promise<boolean>;
  online: boolean;
  autoFocus?: boolean;
  onSaved?: () => void;
}) {
  const [path, setPath] = useState(current);
  const [busy, setBusy] = useState(false);
  const recent = (office?.recentProjects ?? []).filter(item => item !== current);
  const run = async (target: string | null) => {
    if (busy) return;
    setBusy(true);
    const ok = await save(target);
    setBusy(false);
    if (ok) { if (target) setPath(target); else setPath(office?.launchDirectory ?? ''); onSaved?.(); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (isAbsoluteWorkspace(path.trim()) && path.trim() !== current) void run(path.trim()); };
  const invalid = path.trim() !== '' && !isAbsoluteWorkspace(path.trim());
  return <form className="project-form" onSubmit={submit}>
    <label htmlFor="office-project">PROJECT FOLDER</label>
    <div className="project-form-row">
      <input id="office-project" data-autofocus={autoFocus || undefined} maxLength={1000} value={path} onChange={event => setPath(event.target.value)}
        placeholder="/home/you/projects/my-app" aria-invalid={invalid} disabled={!online || busy}/>
      <button type="submit" className="primary-btn" disabled={!online || busy || invalid || !path.trim() || path.trim() === current}><Check size={15}/>{busy ? 'Saving…' : 'Use folder'}</button>
    </div>
    {invalid && <p className="form-error" role="status">Enter an absolute project path.</p>}
    <p className="project-hint">{office?.projectDirectory
      ? 'Every agent works here by default: new tasks, schedules, chats and team notes. You can still pick another folder for a single task.'
      : `Using the folder Agent Office was started from. Set a project folder to keep it for every task.`}</p>
    {office?.projectDirectory && office.launchDirectory !== office.projectDirectory && <button type="button" className="office-reset" disabled={!online || busy} onClick={() => void run(null)}>
      <RotateCcw size={13}/>Use the launch folder ({folderName(office.launchDirectory)})</button>}
    {recent.length > 0 && <>
      <span className="field-label project-recent-label"><History size={13}/>RECENT PROJECTS</span>
      <ul className="project-recent">{recent.map(item => <li key={item}>
        <button type="button" disabled={!online || busy} onClick={() => void run(item)} title={item}><FolderOpen size={14}/><strong>{folderName(item)}</strong><span>{item}</span></button>
        <button type="button" className="project-forget" disabled={!online || busy} onClick={() => void forget(item)} aria-label={`Forget ${item}`} title="Remove from recent projects"><X size={13}/></button>
      </li>)}</ul>
    </>}
  </form>;
}

/** Top-bar button showing the office project; opens the project dialog. */
export function ProjectPill({ current, onOpen }: { current: string; onOpen: () => void }) {
  return <button type="button" className="project-pill" onClick={onOpen} title={`Project folder: ${current}`} aria-label={`Project folder: ${current}. Change`}>
    <FolderOpen size={14}/><span>{folderName(current) || 'Choose project'}</span>
  </button>;
}

/** The office project dialog, opened from the top bar or the project files on the reception desk. */
export function ProjectDialog({ close, ...props }: Omit<Parameters<typeof ProjectForm>[0], 'autoFocus' | 'onSaved'> & { close: () => void }) {
  return <Modal close={close} labelledBy="project-title">
    <div className="modal-title">
      <div><span className="eyebrow"><span /> OFFICE PROJECT</span><h2 id="project-title">Where your agents work <b>✳</b></h2></div>
      <button type="button" onClick={close} aria-label="Close"><X size={19}/></button>
    </div>
    <ProjectForm {...props} autoFocus onSaved={close}/>
  </Modal>;
}
