import Link from "next/link";

const LINKS = [
  { href: "/booth", label: "Booth" },
  { href: "/library", label: "Library" },
  { href: "/moods", label: "Moods" },
  { href: "/history", label: "History" },
  { href: "/help", label: "Help" },
] as const;

export function Nav({ active }: { active: (typeof LINKS)[number]["href"] }) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <Link href="/booth" className="text-lg font-semibold tracking-tight">
        AI DJ <span className="text-accent">Mixer</span>
      </Link>
      <nav className="flex gap-1 text-sm">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 ${active === l.href ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
