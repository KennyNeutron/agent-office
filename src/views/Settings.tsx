import { FolderOpen, Radio, ShieldCheck, Palette } from 'lucide-react';
import type { ServerState } from '../types';
import { useLanguage } from '../locales/i18n';
import { useOfficePreferences } from '../scene/OfficePreferencesContext';
import { DEFAULT_OFFICE_PREFERENCES, type OfficeTheme, type OfficeSpacing, type OfficeMotion } from '../scene/officePreferences';
import { DEPARTMENTS } from '../agents';

export function Settings({ workspace, setWorkspace, demo, setDemo, server, online, publicPreview = false }: {
  workspace: string;
  setWorkspace: (v: string) => void;
  demo: boolean;
  setDemo: (v: boolean) => void;
  server: ServerState | null;
  online: boolean;
  publicPreview?: boolean;
}) {
  const { t: tr } = useLanguage();
  const { preferences, updatePreferences } = useOfficePreferences();
  return <>
    <div className="sub-intro">
      <span className="eyebrow"><span /> {tr('YOUR ENVIRONMENT')}</span>
      <h1>{tr('Workspace settings')}</h1>
      <p>{tr('Choose where your agents work and which data you want to see.')}</p>
    </div>
    <div className="settings-content">
      <section className="setting-card office-customization">
        <div className="setting-heading"><Palette size={22}/><div><h2>{tr('Office appearance')}</h2><p>{tr('Customize the virtual workspace. Saved only in this browser.')}</p></div></div>
        <div className="office-options">
          <div><label htmlFor="office-theme">{tr('Visual style')}</label><select id="office-theme" value={preferences.theme} onChange={e => updatePreferences({ theme: e.target.value as OfficeTheme })}>
            <option value="daylight">{tr('Bright modern')}</option><option value="midnight">{tr('Midnight')}</option><option value="warm">{tr('Warm studio')}</option>
          </select></div>
          <div><label htmlFor="office-spacing">{tr('Room spacing')}</label><select id="office-spacing" value={preferences.spacing} onChange={e => updatePreferences({ spacing: e.target.value as OfficeSpacing })}>
            <option value="compact">{tr('Compact')}</option><option value="regular">{tr('Balanced')}</option><option value="spacious">{tr('Spacious')}</option>
          </select></div>
          <div><label htmlFor="office-motion">{tr('Agent movement')}</label><select id="office-motion" value={preferences.motion} onChange={e => updatePreferences({ motion: e.target.value as OfficeMotion })}>
            <option value="off">{tr('Off')}</option><option value="subtle">{tr('Subtle')}</option><option value="lively">{tr('Lively')}</option>
          </select></div>
          <div><label htmlFor="office-accent">{tr('Office accent color')}</label><input id="office-accent" type="color" value={preferences.accent} onChange={e => updatePreferences({ accent: e.target.value })}/></div>
        </div>
        <div className="office-sector-colors" aria-label={tr('Department')}>
          {DEPARTMENTS.map(department => <label key={department.id} htmlFor={`office-sector-${department.id}`}>
            <span>{tr(department.name)}</span><input id={`office-sector-${department.id}`} type="color"
              value={preferences.sectorColors[department.id] || department.color}
              onChange={e => updatePreferences({ sectorColors: { ...preferences.sectorColors, [department.id]: e.target.value } })}/>
          </label>)}
        </div>
        <button className="office-reset" type="button" onClick={() => updatePreferences(DEFAULT_OFFICE_PREFERENCES)}>{tr('Restore office defaults')}</button>
      </section>
      {!publicPreview && <section className="setting-card">
        <div className="setting-heading"><FolderOpen size={22}/><div><h2>{tr('Project directory')}</h2><p>{tr('Choose where your agents work and which data you want to see.')}</p></div></div>
        <label htmlFor="path">{tr('WORKSPACE PATH')}</label>
        <input id="path" maxLength={1000} value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="C:\\path\\to\\project"/>
        <p>{tr('One task per project folder')}</p>
      </section>}
      {!publicPreview && <section className="setting-card">
        <div className="setting-heading"><Radio size={22}/><div><h2>{tr('Data source')}</h2><p>{tr('Choose the CLI used for each task.')}</p></div></div>
        <div className="setting-row"><div><strong>{tr('Demo environment')}</strong><span>{tr('Sample events for exploring the office')}</span></div>
          <button className={`switch ${demo ? 'enabled' : ''}`} onClick={() => setDemo(!demo)} aria-pressed={demo} aria-label={tr('Demo mode')}><span /></button>
        </div>
        <p>{tr('Choose the CLI used for each task.')}</p>
        {!online && <p role="status">{tr('API OFFLINE')}</p>}
        {(server?.providers || []).map(item => <div className="setting-row" key={item.id}>
          <div><strong>{item.name}</strong><span>{tr(!online ? 'API OFFLINE' : item.available ? 'Detected on this computer' : 'Start API and install an AI CLI')}</span></div>
          <span className={`setting-ready ${online && item.available ? 'yes' : ''}`}>{tr(!online ? 'API OFFLINE' : item.available ? 'READY' : 'NOT FOUND')}</span>
        </div>)}
      </section>}
      <section className="setting-card">
        <div className="setting-heading"><ShieldCheck size={22}/><div><h2>{tr('Privacy & safety')}</h2><p>{tr(publicPreview ? 'Preview only · no real execution' : 'Your office runs locally.')}</p></div></div>
        {publicPreview ? <><p>{tr('Demo environment')} · {tr('Sample activity only')}</p><p>{tr('Preview only · no real execution')}. {tr('Changes take effect immediately and are saved on this device.')}</p></> : <><p>{tr('One task per project folder')}</p><p>{tr('The API runs on your computer. Tasks use your installed AI CLI. Recent activity stays in .local/tasks.json.')}</p></>}
      </section>
    </div>
  </>;
}
