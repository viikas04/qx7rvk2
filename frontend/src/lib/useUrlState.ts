import { useCallback, useEffect, useState } from "react";

/**
 * Keeps view state in the URL query string so any screen can be shared as a
 * link ("look at 15 Jan with a 10:00 decision") and survives a refresh.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const read = useCallback((): T => {
    const q = new URLSearchParams(window.location.search);
    const out = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof T)[]) {
      const v = q.get(k as string);
      if (v != null && v !== "") out[k] = v as T[keyof T];
    }
    return out;
  }, [defaults]);

  const [state, setState] = useState<T>(read);

  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(next)) if (v !== defaults[k]) q.set(k, v);
        const url = `${window.location.pathname}${q.size ? `?${q}` : ""}`;
        window.history.replaceState(null, "", url);
        return next;
      });
    },
    [defaults],
  );

  return [state, update] as const;
}
