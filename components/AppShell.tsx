"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useOffline } from "next/offline";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * App-wide client pieces: registers the service worker (production only, so
 * dev never serves stale code) and shows a banner while offline.
 */
export function AppShell() {
  // Next detects lost connectivity when a request fails; the browser's flag covers a cold offline start.
  const browserOffline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  const offline = useOffline() || browserOffline;
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } else {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    }
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="bg-warn/15 px-6 py-2 text-center text-sm text-warn">
      Offline — the music keeps playing from this computer. Switching pages waits until the connection is back.
    </div>
  );
}
