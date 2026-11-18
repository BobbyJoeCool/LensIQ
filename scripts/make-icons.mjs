// Renders the app icon to the PNG sizes iOS and the web manifest need.
// Run once with: node scripts/make-icons.mjs (uses Playwright's Chromium).
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Full-bleed square (iOS rounds the corners itself) with the magnifier from favicon.svg.
const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
  <rect width="32" height="32" fill="#0f172a"/>
  <g transform="translate(${pad} ${pad}) scale(${(32 - 2 * pad) / 32})">
    <circle cx="14" cy="14" r="7" fill="none" stroke="#38bdf8" stroke-width="3"/>
    <path d="M19 19l6 6" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>
  </g></svg>`;

const outputs = [
  ['web/public/apple-touch-icon.png', 180, 4],
  ['web/public/icon-192.png', 192, 4],
  ['web/public/icon-512.png', 512, 4],
  ['web/public/icon-maskable-512.png', 512, 7], // extra padding for Android's safe zone
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, pad] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await writeFile(file, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', file);
}
await browser.close();
