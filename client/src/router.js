import { useEffect, useState } from 'react';

// Hash routes: #/<runId>/<page>/<arg>?a=b   e.g. #/RUN-0001/day/12, #/RUN-0001/product/RTE03
export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const [runId = null, page = null, arg = null] = pathPart.split('/').filter(Boolean);
  return { runId, page, arg, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

export function href(runId, page, arg, query) {
  const q = query ? Object.entries(query).filter(([, v]) => v != null && v !== '') : [];
  return `#/${runId}/${page}${arg != null ? `/${arg}` : ''}${q.length ? `?${new URLSearchParams(q)}` : ''}`;
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
