// Run from the project root: node scripts/make-icons.mjs "$PWD"
// Draws the app icon (a vinyl record on a jog wheel, in the app's accent colours) and renders PNG / ICO sizes.
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const root = process.argv[2];
/** full: square full-bleed background (apple / maskable); scale: disc size inside the safe zone. */
function svg({ full = false, scale = 1 } = {}) {
  const s = scale;
  const c = 32;
  const r = (x) => +(x * s).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="label" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f472b6"/><stop offset="1" stop-color="#fb923c"/>
    </linearGradient>
  </defs>
  ${full ? `<rect width="64" height="64" fill="#12121a"/>` : `<rect x="1" y="1" width="62" height="62" rx="15" fill="#12121a"/>`}
  <circle cx="${c}" cy="${c}" r="${r(25)}" fill="#0b0b12" stroke="url(#ring)" stroke-width="${r(5)}"/>
  <circle cx="${c}" cy="${c}" r="${r(18.5)}" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="${r(1.2)}"/>
  <circle cx="${c}" cy="${c}" r="${r(14.5)}" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="${r(1)}"/>
  <circle cx="${c}" cy="${c}" r="${r(9.5)}" fill="url(#label)"/>
  <circle cx="${c}" cy="${c}" r="${r(2.2)}" fill="#0b0b12"/>
  <line x1="${c}" y1="${c - r(24.5)}" x2="${c}" y2="${c - r(15)}" stroke="#f2f2f7" stroke-width="${r(3.6)}" stroke-linecap="round"/>
</svg>
`;
}

writeFileSync(`${root}/app/icon.svg`, svg());
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(markup, size) {
  await page.setViewportSize({ width: size, height: size });
  const url = "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${url}" width="${size}" height="${size}" style="display:block"></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
mkdirSync(`${root}/public/icons`, { recursive: true });
writeFileSync(`${root}/public/icons/icon-192.png`, await png(svg(), 192));
writeFileSync(`${root}/public/icons/icon-512.png`, await png(svg(), 512));
writeFileSync(`${root}/public/icons/maskable-512.png`, await png(svg({ full: true, scale: 0.8 }), 512));
writeFileSync(`${root}/app/apple-icon.png`, await png(svg({ full: true, scale: 0.86 }), 180));

// favicon.ico: 16, 32 and 48 px PNGs in one ICO (for browsers and places that only ask for /favicon.ico).
const sizes = [16, 32, 48];
const images = [];
for (const n of sizes) images.push(await png(svg(), n));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((n, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(n, 0);
  e.writeUInt8(n, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
writeFileSync(`${root}/app/favicon.ico`, Buffer.concat([header, ...dir, ...images]));
await browser.close();
