"use client";

// One requestAnimationFrame loop for the whole booth display. It reads the
// AutoDJ's snapshot once per frame and hands it to every subscribed widget,
// which writes straight to the DOM (no React re-render per frame).
// Display only: nothing here can change the mix.

import { useEffect, useRef } from "react";
import type { BoothSnapshot } from "@/lib/dj/autodj";
import { useSession } from "@/store/session";

type Subscriber = (snap: BoothSnapshot | null) => void;

const subscribers = new Set<Subscriber>();
let raf = 0;

function loop() {
  const snap = useSession.getState().snapshot();
  for (const fn of subscribers) fn(snap);
  raf = requestAnimationFrame(loop);
}

/** Call `callback` with the latest deck snapshot on every animation frame. */
export function useBoothFrame(callback: Subscriber): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    const fn: Subscriber = (snap) => latest.current(snap);
    subscribers.add(fn);
    if (subscribers.size === 1) raf = requestAnimationFrame(loop);
    return () => {
      subscribers.delete(fn);
      if (subscribers.size === 0) cancelAnimationFrame(raf);
    };
  }, []);
}

/** Set an element's text only when it changes (avoids layout work every frame). */
export function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/** m:ss */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
