"use client";

import { createContext, useContext, useEffect, useState } from "react";

const OnlineContext = createContext(true);

/** True when the browser has a network connection. */
export function useOnline() {
  return useContext(OnlineContext);
}

/**
 * Registers the service worker and tracks connectivity. The banner matters on
 * a mountain: the user needs to know the app is running on cached data.
 */
export default function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    // Reflect the real connection state once mounted (the server always
    // renders the online case).
    if (!navigator.onLine) down();
    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    if ("serviceWorker" in navigator) {
      // After load so registration never competes with first paint.
      const register = () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          /* unsupported context (e.g. plain-http dev) — app still works */
        });
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return (
    <OnlineContext.Provider value={online}>
      {!online && (
        <div className="sticky top-0 z-[60] bg-trail-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          Offline — showing downloaded maps and trails
        </div>
      )}
      {children}
    </OnlineContext.Provider>
  );
}
