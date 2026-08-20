"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

// localStorage is an external store, so React should subscribe to it rather
// than copy it into state inside an effect. This also keeps every mounted
// component in sync when one of them writes.

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notify all subscribers that local data changed (call after any write). */
export function notifyLocalStore(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    // Another tab writing localStorage should update this one too.
    window.addEventListener("storage", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", listener);
    }
  };
}

/**
 * Read a localStorage-backed value.
 *
 * `read` must return a referentially stable result for unchanged data —
 * getSnapshot is called on every render, so a fresh object each time would
 * loop forever. Callers pass a `version` string that changes only when the
 * underlying data does; the result is memoised against it.
 */
export function useLocalStore<T>(read: () => T, serverValue: T): T {
  // The cache must outlive a render, or every render allocates a new object
  // and useSyncExternalStore loops.
  const cache = useRef<{ key: string; value: T } | null>(null);

  const getSnapshot = useCallback(() => {
    const value = read();
    const key = JSON.stringify(value);
    if (!cache.current || cache.current.key !== key) {
      cache.current = { key, value };
    }
    return cache.current.value;
    // `read` is provided by the caller and expected to be stable.
  }, [read]);

  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}
