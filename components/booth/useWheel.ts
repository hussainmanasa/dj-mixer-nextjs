"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Scroll over a control turns it instead of scrolling the page (knobs, faders, the tempo slider). React's own
 * `onWheel` is passive and can't stop the page, so this listens natively with `passive: false`.
 *
 * `handle(amount, notch)`: `amount` is up / right positive — pixels for a trackpad's two-finger swipe (whichever axis
 * moved more), or ±1 per click of a mouse wheel (`notch`). A pinch (Ctrl + wheel) is ignored but still doesn't
 * scroll the page.
 */
export function useWheel(ref: RefObject<HTMLElement | null>, handle: (amount: number, notch: boolean) => void): void {
  const latest = useRef(handle);
  useEffect(() => {
    latest.current = handle;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) return;
      const up = -e.deltaY;
      const right = e.deltaX;
      const amount = Math.abs(right) > Math.abs(up) ? right : up;
      if (amount === 0) return;
      // A mouse wheel click: line / page mode, or a whole ±100 px step.
      const notch = e.deltaMode !== 0 || (Math.abs(amount) >= 100 && Number.isInteger(amount));
      latest.current(notch ? Math.sign(amount) : amount, notch);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
