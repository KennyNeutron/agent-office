import type { McpServerInput } from '../types';

type Draft = Omit<McpServerInput, 'agents' | 'enabled' | 'autoApprove'>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): Record<string, string> => object(value)
  ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string') as [string, string][]) : {};

/**
 * Reads the JSON snippets MCP servers publish for Claude Code, Codex, Cursor and
 * similar tools: `{ "mcpServers": { "name": { … } } }`, `{ "name": { … } }` or a
 * bare server object. Returns every server found, or an error message.
 */
export function parseMcpJson(source: string): Draft[] | string {
  let data: unknown;
  try { data = JSON.parse(source); } catch { return 'That is not valid JSON.'; }
  if (!object(data)) return 'Paste a JSON object.';
  const container = object(data.mcpServers) ? data.mcpServers : object(data.servers) ? data.servers : object(data.mcp_servers) ? data.mcp_servers : null;
  const entries: [string, unknown][] = container ? Object.entries(container)
    : 'command' in data || 'url' in data ? [['', data]] : Object.entries(data);
  const drafts: Draft[] = [];
  for (const [name, value] of entries) {
    if (!object(value)) continue;
    const url = typeof value.url === 'string' ? value.url : typeof value.serverUrl === 'string' ? value.serverUrl : '';
    const command = typeof value.command === 'string' ? value.command : '';
    if (!url && !command) continue;
    const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : [];
    drafts.push({
      name: name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40),
      description: typeof value.description === 'string' ? value.description.slice(0, 300) : '',
      transport: url && !command ? 'http' : 'stdio',
      command, args, url,
      env: strings(value.env),
      headers: strings(value.headers ?? value.http_headers),
    });
  }
  return drafts.length ? drafts : 'No MCP server with a "command" or "url" was found.';
}
