import { useState } from 'react';
import { Package, Server } from 'lucide-react';
import { McpServers } from '../components/McpServers';
import { PluginManager } from '../components/PluginManager';

type Tab = 'mcp' | 'plugins';
const TAB_KEY = 'agent-office-tools-tab';

export function Tools({ online, demo, version, publicPreview }: { online: boolean; demo: boolean; version: number; publicPreview: boolean }) {
  const [tab, setTab] = useState<Tab>(() => { try { return localStorage.getItem(TAB_KEY) === 'plugins' ? 'plugins' : 'mcp'; } catch { return 'mcp'; } });
  const choose = (next: Tab) => { setTab(next); try { localStorage.setItem(TAB_KEY, next); } catch { /* Storage disabled. */ } };
  const live = online && !demo && !publicPreview;
  return <>
    <div className="sub-intro">
      <span className="eyebrow"><span /> AGENT TOOLS</span>
      <h1>Tools &amp; plugins</h1>
      <p>Give your agents extra tools with MCP servers, and manage the plugins of each coding CLI.</p>
    </div>
    <div className="tools-content">
      <div className="tools-tabs" role="tablist" aria-label="Tools">
        <button type="button" role="tab" aria-selected={tab === 'mcp'} className={tab === 'mcp' ? 'on' : ''} onClick={() => choose('mcp')}><Server size={15}/>MCP servers</button>
        <button type="button" role="tab" aria-selected={tab === 'plugins'} className={tab === 'plugins' ? 'on' : ''} onClick={() => choose('plugins')}><Package size={15}/>Plugins</button>
      </div>
      {!live ? <div className="kb-empty" role="status">
        {tab === 'mcp' ? <Server size={22}/> : <Package size={22}/>}
        <strong>{publicPreview ? 'Not available in the online demo' : demo ? 'Switch to Live mode' : 'The local API is offline'}</strong>
        <p>{publicPreview ? 'MCP servers and plugins are managed by the Agent Office app on your computer.'
          : demo ? 'MCP servers and plugins are used by real agent runs. Turn on Live mode in the top bar to manage them.'
          : 'Start Agent Office again to manage MCP servers and plugins.'}</p>
      </div> : tab === 'mcp' ? <McpServers online={online} version={version}/> : <PluginManager online={online}/>}
    </div>
  </>;
}
