// Draws the logo: the shuttle seen from the front in white, with a blue band and orange lamps, in front of the sun
// ("SoL"), on the bus's blue. One drawing makes the app icons and the
// 120px logo Google's sign-in screen asks for.  node scripts/make-icons.mjs
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const BLUE = '#2748c9';
const DEEP = '#16297a';
const ORANGE = '#f6921e';
const WHITE = '#ffffff';

/** `corner` rounds the tile itself, for places that don't round it for you (a web page, Google's screen). */
const svg = (size, corner = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" rx="${corner}" fill="${BLUE}"/>
  <circle cx="256" cy="246" r="196" fill="${ORANGE}"/>
  <rect x="146" y="386" width="58" height="52" rx="14" fill="${DEEP}"/>
  <rect x="308" y="386" width="58" height="52" rx="14" fill="${DEEP}"/>
  <rect x="90" y="222" width="34" height="56" rx="12" fill="${WHITE}"/>
  <rect x="388" y="222" width="34" height="56" rx="12" fill="${WHITE}"/>
  <rect x="114" y="150" width="284" height="262" rx="58" fill="${WHITE}"/>
  <rect x="146" y="186" width="220" height="104" rx="28" fill="${BLUE}"/>
  <rect x="114" y="314" width="284" height="24" fill="${BLUE}"/>
  <circle cx="170" cy="374" r="17" fill="${ORANGE}"/>
  <circle cx="342" cy="374" r="17" fill="${ORANGE}"/>
</svg>`;

const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname.slice(1);

for (const [name, size, corner] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // Rounded, for the top of the app and for Google's sign-in screen (which wants a square of 120px).
  ['logo-120.png', 120, 112],
  ['logo-512.png', 512, 112],
]) {
  await sharp(Buffer.from(svg(size, corner))).png().toFile(out(name));
}
await writeFile(out('logo.svg'), svg(512, 112));
console.log('icons written');
