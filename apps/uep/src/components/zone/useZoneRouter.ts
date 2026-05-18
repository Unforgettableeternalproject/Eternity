import { useEffect, useRef, useCallback } from 'react';

interface ZoneRoute {
  param: string;
  handler: (value: string) => void;
}

interface UseZoneRouterOptions {
  routes: ZoneRoute[];
  onLanding: () => void;
  treeReady: boolean;
  setBootNavPending?: (pending: boolean) => void;
}

export function pushUrl(params: Record<string, string>) {
  const url = new URL(window.location.href);
  url.search = '';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  window.history.pushState({}, '', url.toString());
}

export function clearUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.pushState({}, '', url.toString());
}

export function useZoneRouter({
  routes,
  onLanding,
  treeReady,
  setBootNavPending,
}: UseZoneRouterOptions) {
  const routesRef = useRef(routes);
  const onLandingRef = useRef(onLanding);
  routesRef.current = routes;
  onLandingRef.current = onLanding;

  const dispatch = useCallback((push: boolean) => {
    const params = new URLSearchParams(window.location.search);
    for (const route of routesRef.current) {
      const value = params.get(route.param);
      if (value) {
        route.handler(value);
        return;
      }
    }
    if (push) onLandingRef.current();
  }, []);

  useEffect(() => {
    if (!treeReady) return;
    const params = new URLSearchParams(window.location.search);
    const hasDeepLink = routesRef.current.some((r) => params.has(r.param));
    if (hasDeepLink) {
      setBootNavPending?.(true);
      dispatch(false);
    }
  }, [treeReady, dispatch, setBootNavPending]);

  useEffect(() => {
    if (!treeReady) return;
    function handler() {
      dispatch(true);
    }
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [treeReady, dispatch]);

  return { pushUrl, clearUrl };
}
