// Keeps interface preferences in the local API's data directory as well as in
// localStorage. The desktop app's webview loads the office from a port chosen at
// launch, and localStorage is tied to that origin, so without this mirror every
// launch would start with default settings.
//
// Only keys starting with "agent-office-" are mirrored. Reads stay synchronous
// (localStorage), so the rest of the app needs no changes.

const PREFIX = 'agent-office-';
const FLUSH_MS = 400;

let pending: Record<string, string | null> = {};
let timer: number | undefined;
let enabled = false;

function flush(keepalive = false) {
  window.clearTimeout(timer);
  timer = undefined;
  const values = pending;
  if (!Object.keys(values).length) return;
  pending = {};
  void fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }), keepalive,
  }).then(response => { if (!response.ok) throw new Error(String(response.status)); })
    .catch(() => { pending = { ...values, ...pending }; });
}

function queue(key: string, value: string | null) {
  if (!enabled || !key.startsWith(PREFIX)) return;
  pending[key] = value;
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, FLUSH_MS);
}

/** Loads saved settings into localStorage, then mirrors later changes. Never throws. */
export async function hydrateSettings(): Promise<void> {
  let storage: Storage;
  try { storage = window.localStorage; } catch { return; }
  let body: { settings?: Record<string, unknown>; desktop?: boolean };
  try {
    const response = await fetch('/api/settings', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    body = await response.json();
  } catch { return; } // No local API (static demo or offline): browser storage only.

  const saved = body.settings && typeof body.settings === 'object' ? body.settings : {};
  const savedKeys = Object.keys(saved).filter(key => key.startsWith(PREFIX) && typeof saved[key] === 'string');
  try {
    if (savedKeys.length) for (const key of savedKeys) storage.setItem(key, saved[key] as string);
    else {
      // First run against this data directory: keep what this browser already had.
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(PREFIX)) pending[key] = storage.getItem(key);
      }
    }
    // The desktop app drives real agents, so it opens in live mode unless the user picked demo.
    if (body.desktop && storage.getItem(PREFIX + 'mode') === null) {
      storage.setItem(PREFIX + 'mode', 'live');
      pending[PREFIX + 'mode'] = 'live';
    }
  } catch { return; }

  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (this === storage) queue(String(key), String(value));
  };
  proto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === storage) queue(String(key), null);
  };
  enabled = true;
  window.addEventListener('pagehide', () => flush(true));
  if (Object.keys(pending).length) flush();
}
