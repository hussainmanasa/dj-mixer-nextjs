"use client";

import { useEffect, useRef, useState } from "react";

/** A section counts as "being read" once its top has passed this far down the window. */
const READING_LINE = 0.3;

/**
 * The Help page's contents, highlighting the section being read: the last one whose top has scrolled past a line
 * 30% down the window (the last section at the very bottom of the page). The highlighted entry is marked
 * `aria-current` and kept in view inside the contents list, which scrolls on its own on short screens.
 */
export function ContentsNav({ sections }: { sections: readonly { id: string; title: string }[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  const list = useRef<HTMLOListElement>(null);
  // A section picked in the contents stays highlighted while the jump settles, and while the page sits at its very
  // bottom (sections near the end can't scroll up to the reading line) — as long as it's on screen.
  const picked = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * READING_LINE;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        // (Hidden while another page is shown: routes stay mounted.)
        if (!el || el.offsetParent === null) return;
        if (el.getBoundingClientRect().top <= line) current = s.id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = sections[sections.length - 1]?.id ?? current;
      const pick = picked.current;
      const box = pick ? document.getElementById(pick.id)?.getBoundingClientRect() : null;
      const onScreen = !!box && box.top < window.innerHeight && box.bottom > 0;
      if (pick && onScreen && (atBottom || performance.now() - pick.at < 800)) current = pick.id;
      else picked.current = null;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Keep the highlighted entry visible inside the (separately scrolling) contents list — without moving the page.
  useEffect(() => {
    const nav = list.current?.parentElement;
    const item = list.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!nav || !item || nav.scrollHeight <= nav.clientHeight) return;
    const top = item.offsetTop - nav.offsetTop;
    if (top < nav.scrollTop + 40) nav.scrollTop = Math.max(0, top - 40);
    else if (top + item.offsetHeight > nav.scrollTop + nav.clientHeight - 40) nav.scrollTop = top + item.offsetHeight - nav.clientHeight + 40;
  }, [active]);

  return (
    <ol ref={list} className="space-y-1 text-sm">
      {sections.map((s) => {
        const on = s.id === active;
        return (
          <li key={s.id} data-id={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={on ? "location" : undefined}
              onClick={() => {
                picked.current = { id: s.id, at: performance.now() };
                setActive(s.id);
              }}
              className={`block rounded-md border-l-2 px-2 py-1 transition-colors ${
                on ? "border-accent bg-surface-2 font-semibold text-foreground" : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {s.title}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
