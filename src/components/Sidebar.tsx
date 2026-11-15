import { Activity, ArrowRight, LayoutDashboard, Layers3, MoreHorizontal, Puzzle, Settings2, Sparkles, Users } from 'lucide-react';
import { displayAgentText, useAgents } from '../agents';
import { useLanguage } from '../locales/i18n';
import type { View } from '../views/types';
import { Avatar } from './Avatar';

export function Sidebar({ view, setView, onNew }: {
    view: View;
    setView: (v: View) => void;
    onNew: () => void;
}) {
    const { t: tr } = useLanguage();
    const agents = useAgents();
    const nav: {
        id: View;
        label: string;
        icon: typeof Activity;
    }[] = [{ id: 'studio', label: 'Office studio', icon: LayoutDashboard }, { id: 'tasks', label: 'Activity & tasks', icon: Activity }, { id: 'team', label: 'Agent team', icon: Users }, { id: 'tools', label: 'Tools & plugins', icon: Puzzle }];
    return <aside className="sidebar"><div className="brand"><span className="brand-logo"><Layers3 size={22}/></span><span><strong>agent<span>office</span></strong><small>{tr("MISSION CONTROL")}</small></span></div>
    <div className="side-label">{tr("WORKSPACE")}</div><nav aria-label={tr("WORKSPACE")}>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)} title={tr(label)} aria-label={tr(label)}><Icon size={18}/>{tr(label)}{view === id && <span className="nav-dot"/>}</button>)}</nav>
    <div className="side-label team-label">{tr("YOUR TEAM") + " "}<span>{agents.length}</span></div><div className="side-team">{agents.slice(0, 12).map(agent => <button key={agent.id} onClick={() => setView('team')}><Avatar id={agent.id} size="sm"/><span><strong>{agent.name}</strong><small>{displayAgentText(agent, 'role', tr)}</small></span><i /></button>)}{agents.length > 12 && <button onClick={() => setView('team')}>+{agents.length - 12} {tr('agents')}</button>}</div>
    <div className="side-spacer"/><div className="side-tip"><span className="tip-illustration"><Sparkles size={18}/></span><strong>{tr("Big ideas start small.")}</strong><p>{tr("Give your agents a mission and watch it come to life.")}</p><button onClick={onNew}>{tr("Create a task") + " "}<ArrowRight size={15}/></button></div>
    <button className={`nav-item settings-nav ${view === 'settings' ? 'active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')} title={tr("Settings")} aria-label={tr("Settings")}><Settings2 size={18}/>{tr("Settings")}</button>
    <div className="side-user"><span>AO</span><div><strong>{tr("Local workspace")}</strong><small>{tr("Personal edition")}</small></div><MoreHorizontal size={18}/></div>
  </aside>;
}
