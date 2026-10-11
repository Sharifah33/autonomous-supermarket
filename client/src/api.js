import { useEffect, useState } from 'react';

// Completed runs are immutable, so GET responses can be cached for the session.
const cache = new Map();

export async function api(path, body) {
  if (!body && cache.has(path)) return cache.get(path);
  const res = await fetch(`/api${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  if (!body && !path.startsWith('/runs?') && path !== '/runs') cache.set(path, data);
  return data;
}

export function useApi(path) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    setState((s) => ({ loading: true, data: s.data }));
    api(path).then(
      (data) => live && setState({ data }),
      (e) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}
