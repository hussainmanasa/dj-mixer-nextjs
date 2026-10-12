@AGENTS.md

## Claude-specific notes

- Read `AGENTS.md` above first; its product decisions are fixed unless the owner says otherwise.
- Before writing Next.js code, check the bundled docs in `node_modules/next/dist/docs/` (this is Next.js 16).
- After any change run `npm run check` and `npm run build`, and report results honestly.
- When you add or change behaviour, update the "Architecture" and "Known limitations" sections in `AGENTS.md`
  so the next agent starts from the truth.
