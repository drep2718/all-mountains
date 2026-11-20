"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Filter state that survives navigating away and coming back.
 *
 * Every browse page kept its search, filters and page number in local
 * `useState`, so all of it died the moment you opened a peak — press back
 * and you were returned to an unfiltered list, having lost the search you
 * had just typed and whatever page of results you had scrolled to. The
 * list pages are the one place in the app where that is guaranteed to
 * happen, because opening a result is the entire point of them.
 *
 * Putting the state in the query string fixes it at the source rather than
 * by caching: the back button restores it because it is restoring a URL,
 * and the same change makes a filtered list something you can bookmark or
 * send to someone.
 *
 * Notes on the implementation, both of which are load-bearing:
 *
 *  - The URL is read in an effect rather than during the initial render.
 *    Reading `window` while rendering gives the server one value and the
 *    client another, which is a hydration mismatch. The cost is that
 *    callers must wait for `ready` before fetching, or they fire one
 *    query against the defaults and a second against the real filters.
 *
 *  - Writes use `history.replaceState`, not `push`. Typing six characters
 *    into a search box should not put six entries in the history stack —
 *    back is for leaving the page, not for un-typing.
 */

type Primitive = string | number | boolean;

/** Parse back to the type of the default, so callers keep their types. */
function coerce<T extends Primitive>(raw: string, fallback: T): T {
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (typeof fallback === "boolean") return (raw === "1" || raw === "true") as T;
  return raw as T;
}

const encode = (v: Primitive): string => (typeof v === "boolean" ? "1" : String(v));

export function useUrlState<T extends Record<string, Primitive>>(
  defaults: T,
  { debounceMs = 300 }: { debounceMs?: number } = {}
): {
  state: T;
  /** Merge a partial update. Anything equal to its default leaves the URL. */
  set: (patch: Partial<T>) => void;
  /** Back to defaults, and a clean URL. */
  reset: () => void;
  /** False until the URL has been read; hold data fetches until it is true. */
  ready: boolean;
} {
  const [state, setState] = useState<T>(defaults);
  const [ready, setReady] = useState(false);

  // `defaults` is almost always a fresh object literal each render, so it
  // cannot be an effect dependency without re-running forever.
  const defaultsRef = useRef(defaults);

  const readUrl = useCallback((): T => {
    const d = defaultsRef.current;
    if (typeof window === "undefined") return d;
    const q = new URLSearchParams(window.location.search);
    const out = { ...d };
    for (const key of Object.keys(d) as (keyof T)[]) {
      const raw = q.get(String(key));
      if (raw != null) out[key] = coerce(raw, d[key]);
    }
    return out;
  }, []);

  useEffect(() => {
    // Deliberately a setState in an effect, which the lint rule flags as a
    // cascading-render risk. It cannot cascade: `readUrl` is stable, the
    // effect has no other trigger, and `ready` latches true, so this runs
    // exactly once per mount. The alternative — reading `window` in a lazy
    // initialiser — renders different markup on the server and the client
    // and produces a hydration mismatch on every filter control, which is
    // a real bug rather than a theoretical one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readUrl());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [readUrl]);

  // Back/forward between two states of the same page. Nothing pushes today,
  // but a page that starts to would otherwise show stale filters.
  useEffect(() => {
    const onPop = () => setState(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readUrl]);

  // Mirror state into the URL, debounced so a keystroke is not a history op.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const d = defaultsRef.current;
      const q = new URLSearchParams(window.location.search);
      for (const key of Object.keys(d) as (keyof T)[]) {
        const k = String(key);
        // Defaults stay out of the URL; a page of plain `/peaks` should not
        // become `/peaks?q=&difficulty=All&iconic=&sort=popular&page=0`.
        if (state[key] === d[key] || state[key] === "" || state[key] === false) q.delete(k);
        else q.set(k, encode(state[key]));
      }
      const qs = q.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      if (next !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(window.history.state, "", next);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [state, ready, debounceMs]);

  const set = useCallback((patch: Partial<T>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setState(defaultsRef.current), []);

  return { state, set, reset, ready };
}
