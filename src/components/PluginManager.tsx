import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Download, Package, Plus, RefreshCw, Search, Store, Trash2, X } from 'lucide-react';
import type { CatalogPlugin, InstalledPlugin, PluginMarketplace, PluginProviderInfo, ProviderId } from '../types';
import { Modal } from './Modal';

type Confirm = { plugin: string; command: string; sha256: string };
const formatInstalls = (count: number | null) => count == null ? '' : count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k installs` : `${count} installs`;

async function call(path: string, method = 'GET', body?: unknown, timeout = 330_000) {
  const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  const data: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data: (data && typeof data === 'object' ? data : {}) as Record<string, unknown> };
}

function CommandReview({ confirm, onAccept, onCancel }: { confirm: Confirm; onAccept: () => void; onCancel: () => void }) {
  return <Modal labelledBy="plugin-confirm-title" close={onCancel}>
    <div className="modal-title"><div><h2 id="plugin-confirm-title">Review the install command</h2><p>{confirm.plugin}</p></div><button type="button" aria-label="Close" onClick={onCancel}><X size={18}/></button></div>
    <p className="plugin-warning"><AlertTriangle size={15}/>This marketplace installs the plugin by running the command below on your computer. Install it only if you trust the marketplace.</p>
    <pre className="plugin-command">{confirm.command}</pre>
    <div className="kb-actions"><button type="button" className="office-reset" data-autofocus onClick={onCancel}>Cancel</button><button type="button" className="primary-btn" onClick={onAccept}>Run it and install</button></div>
  </Modal>;
}

export function PluginManager({ online }: { online: boolean }) {
  const [providers, setProviders] = useState<PluginProviderInfo[]>([]);
  const [active, setActive] = useState<ProviderId>('claude');
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [catalog, setCatalog] = useState<{ plugins: CatalogPlugin[]; total: number } | null>(null);
  const [marketplaces, setMarketplaces] = useState<PluginMarketplace[]>([]);
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const provider = providers.find(item => item.id === active);
  const features = provider?.features;
  const available = Boolean(provider?.available);
  const hasCatalog = Boolean(features?.catalog);
  const hasMarketplaces = Boolean(features?.marketplaces);

  useEffect(() => {
    if (!online) return;
    void call('/api/plugins').then(result => {
      const list = Array.isArray(result.data.providers) ? result.data.providers as PluginProviderInfo[] : [];
      setProviders(list);
      setActive(current => list.some(item => item.id === current && item.available) ? current : list.find(item => item.available)?.id ?? current);
    }).catch(() => setError('Could not load the CLIs.'));
  }, [online]);

  const loadInstalled = useCallback(async () => {
    setInstalled(null);
    const result = await call('/api/plugins/' + active, 'GET', undefined, 90_000).catch(() => null);
    if (!result?.ok) { setInstalled([]); setError(String(result?.data.error || 'Could not list plugins.')); return; }
    setInstalled(result.data.plugins as InstalledPlugin[]);
  }, [active]);
  const loadCatalog = useCallback(async (text: string, refresh = false) => {
    setCatalogLoading(true);
    const result = await call(`/api/plugins/${active}/catalog?` + new URLSearchParams({ q: text, ...(refresh ? { refresh: '1' } : {}) }), 'GET', undefined, 150_000).catch(() => null);
    setCatalogLoading(false);
    if (!result?.ok) { setCatalog({ plugins: [], total: 0 }); setError(String(result?.data.error || 'Could not load the catalog.')); return; }
    setCatalog(result.data as { plugins: CatalogPlugin[]; total: number });
  }, [active]);
  const loadMarketplaces = useCallback(async () => {
    const result = await call(`/api/plugins/${active}/marketplaces`, 'GET', undefined, 90_000).catch(() => null);
    setMarketplaces(result?.ok && Array.isArray(result.data.marketplaces) ? result.data.marketplaces as PluginMarketplace[] : []);
  }, [active]);

  useEffect(() => {
    if (!online || !available) return;
    // Switching CLI starts from a clean view, then loads that CLI's plugins.
    const timer = window.setTimeout(() => {
      setError(''); setMessage(''); setCatalog(null); setQuery(''); setMarketplaces([]);
      void loadInstalled();
      if (hasCatalog) void loadCatalog('');
      if (hasMarketplaces) void loadMarketplaces();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [online, available, hasCatalog, hasMarketplaces, loadInstalled, loadCatalog, loadMarketplaces]);

  function search(text: string) {
    setQuery(text);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => void loadCatalog(text), 250);
  }
  async function act(action: 'install' | 'uninstall' | 'enable' | 'disable', plugin: string, extra: Record<string, string> = {}) {
    setWorking(`${action}:${plugin}`); setError(''); setMessage('');
    const result = await call(`/api/plugins/${active}/${action}`, 'POST', { plugin, ...extra }).catch(() => null);
    setWorking(null);
    const confirmation = result?.data.confirm as { command: string; sha256: string } | undefined;
    if (result?.status === 409 && confirmation) { setConfirm({ plugin, ...confirmation }); return false; }
    if (!result?.ok) { setError(String(result?.data.error || `Could not ${action} ${plugin}.`)); return false; }
    const done = { install: 'Installed', uninstall: 'Removed', enable: 'Turned on', disable: 'Turned off' }[action];
    setMessage(`${done} ${plugin}. It applies to new ${provider?.name} runs, in the office and outside it.`);
    void loadInstalled();
    if (features?.catalog && action !== 'enable' && action !== 'disable') void loadCatalog(query);
    return true;
  }
  async function installByName(event: FormEvent) {
    event.preventDefault();
    if (byName.trim() && await act('install', byName.trim())) setByName('');
  }
  async function marketplace(method: 'POST' | 'DELETE', value: string) {
    if (method === 'DELETE' && !window.confirm(`Remove the marketplace "${value}"? Plugins installed from it stay installed.`)) return;
    setWorking('marketplace'); setError(''); setMessage('');
    const result = await call(method === 'POST' ? `/api/plugins/${active}/marketplaces` : `/api/plugins/${active}/marketplaces/${encodeURIComponent(value)}`, method, method === 'POST' ? { source: value } : undefined).catch(() => null);
    setWorking(null);
    if (!result?.ok) { setError(String(result?.data.error || 'Could not update marketplaces.')); return; }
    if (method === 'POST') setSource('');
    setMessage(method === 'POST' ? `Added marketplace ${value}.` : `Removed marketplace ${value}.`);
    void loadMarketplaces(); if (features?.catalog) void loadCatalog(query, true);
  }
  async function uninstall(plugin: InstalledPlugin) {
    if (!window.confirm(`Uninstall ${plugin.id} from ${provider?.name}? This also removes it outside Agent Office.`)) return;
    await act('uninstall', plugin.id, plugin.scope && /^(user|project|local)$/.test(plugin.scope) ? { scope: plugin.scope } : {});
  }

  return <section className="tools-section" aria-labelledby="plugins-title">
    <div className="tools-section-head"><div><h2 id="plugins-title">Plugins</h2>
      <p>Plugins are managed with each CLI's own plugin system, so changes here also apply when you use the CLI outside Agent Office.</p></div></div>
    <div className="plugin-tabs" role="tablist" aria-label="CLI">
      {providers.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === active} className={item.id === active ? 'on' : ''} disabled={!item.available}
        onClick={() => setActive(item.id)} title={item.available ? item.name : `${item.name} was not found`}>{item.name}{!item.available && <small>not found</small>}</button>)}
    </div>
    {!provider?.available && providers.length > 0 && <p className="mcp-note">Install {provider?.name ?? 'the CLI'} to manage its plugins.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="plugin-message" role="status">{message}</p>}
    {provider?.available && <>
      <div className="plugin-block">
        <h3><Package size={15}/>Installed{installed && <span>{installed.length}</span>}<button type="button" className="mcp-icon-btn" aria-label="Refresh installed plugins" onClick={() => void loadInstalled()}><RefreshCw size={13}/></button></h3>
        {installed === null ? <p className="mcp-note" role="status">Loading…</p> : installed.length === 0 ? <p className="mcp-note">No plugins installed in {provider.name}.</p> :
          <ul className="plugin-list">{installed.map(plugin => <li key={plugin.id}>
            <div><strong>{plugin.name}</strong><small>{[plugin.marketplace, plugin.version && `v${plugin.version}`, plugin.scope && `${plugin.scope} scope`].filter(Boolean).join(' · ')}</small></div>
            <div className="mcp-actions">
              {features?.toggle && <button type="button" className={`switch ${plugin.enabled ? 'enabled' : ''}`} aria-pressed={plugin.enabled} aria-label={`${plugin.enabled ? 'Turn off' : 'Turn on'} ${plugin.name}`}
                disabled={working !== null} onClick={() => void act(plugin.enabled ? 'disable' : 'enable', plugin.id, plugin.scope && /^(user|project|local)$/.test(plugin.scope) ? { scope: plugin.scope } : {})}><span/></button>}
              <button type="button" className="mcp-icon-btn danger" aria-label={`Uninstall ${plugin.name}`} disabled={working !== null} onClick={() => void uninstall(plugin)}><Trash2 size={14}/></button>
            </div>
          </li>)}</ul>}
      </div>
      {features?.catalog && <div className="plugin-block">
        <h3><Search size={15}/>Browse marketplaces{catalog && <span>{catalog.total}</span>}<button type="button" className="mcp-icon-btn" aria-label="Refresh catalog" onClick={() => void loadCatalog(query, true)}><RefreshCw size={13}/></button></h3>
        <div className="search-box plugin-search"><Search size={15}/><input aria-label="Search plugins" value={query} placeholder="Search plugins, e.g. github, figma, testing" onChange={e => search(e.target.value)}/></div>
        {catalogLoading && !catalog ? <p className="mcp-note" role="status">Loading the catalog. The first load can take a minute…</p> :
          catalog && <ul className="plugin-list plugin-catalog">{catalog.plugins.map(plugin => <li key={plugin.id}>
            <div><strong>{plugin.name}<small>{plugin.marketplace}</small></strong>{plugin.description && <p>{plugin.description}</p>}{plugin.installs != null && <small>{formatInstalls(plugin.installs)}</small>}</div>
            {plugin.installed ? <span className="setting-ready yes">Installed</span> :
              <button type="button" className="primary-btn plugin-install" disabled={working !== null} onClick={() => void act('install', plugin.id)}>
                {working === `install:${plugin.id}` ? 'Installing…' : <><Download size={13}/>Install</>}</button>}
          </li>)}
          {catalog.plugins.length === 0 && <li className="mcp-note">No plugins match "{query}".</li>}
          {catalog.total > catalog.plugins.length && <li className="mcp-note">Showing {catalog.plugins.length} of {catalog.total}. Search to narrow it down.</li>}
          </ul>}
      </div>}
      <form className="plugin-block" onSubmit={installByName}>
        <h3><Download size={15}/>Install by name</h3>
        <div className="project-form-row"><input aria-label="Plugin to install" className="mcp-mono" value={byName} placeholder={features?.installHint ?? 'plugin@marketplace'} onChange={e => setByName(e.target.value)}/>
          <button type="submit" className="primary-btn" disabled={!byName.trim() || working !== null}>{working === `install:${byName.trim()}` ? 'Installing…' : 'Install'}</button></div>
      </form>
      {features?.marketplaces && <div className="plugin-block">
        <h3><Store size={15}/>Marketplaces</h3>
        <ul className="plugin-list">{marketplaces.map(item => <li key={item.name}><div><strong>{item.name}</strong><small className="mcp-mono">{item.source}</small></div>
          <button type="button" className="mcp-icon-btn danger" aria-label={`Remove marketplace ${item.name}`} disabled={working !== null} onClick={() => void marketplace('DELETE', item.name)}><Trash2 size={14}/></button></li>)}</ul>
        <form className="project-form-row" onSubmit={event => { event.preventDefault(); if (source.trim()) void marketplace('POST', source.trim()); }}>
          <input aria-label="Marketplace source" className="mcp-mono" value={source} placeholder="owner/repo, a git URL or a folder" onChange={e => setSource(e.target.value)}/>
          <button type="submit" className="primary-btn" disabled={!source.trim() || working !== null}><Plus size={14}/>Add</button>
        </form>
      </div>}
    </>}
    {confirm && <CommandReview confirm={confirm} onCancel={() => setConfirm(null)} onAccept={() => { const next = confirm; setConfirm(null); void act('install', next.plugin, { acceptCommand: next.sha256 }); }}/>}
  </section>;
}

