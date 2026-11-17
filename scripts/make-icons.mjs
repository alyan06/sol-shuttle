// Makes every icon from the logo in assets/logo-source.jpg (the bus on a winding road under the
// sun, chosen by Alyan on 2026-11-17). The source has a thin frame round a rounded tile, so a
// little is trimmed off each side to leave a full square: phones round app icons themselves.
// The rounded copies are for places that don't: the top bar and Google's sign-in screen.
//   node scripts/make-icons.mjs
import sharp from 'sharp';

const SOURCE = new URL('../assets/logo-source.jpg', import.meta.url).pathname.slice(1);
const TRIM = 56 / 1024;
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname.slice(1);

const meta = await sharp(SOURCE).metadata();
const inset = Math.round(meta.width * TRIM);
const side = Math.min(meta.width, meta.height) - inset * 2;
const square = await sharp(SOURCE).extract({ left: inset, top: inset, width: side, height: side }).png().toBuffer();

function rounded(size) {
  const radius = Math.round(size * 0.22);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}

for (const [name, size, round] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
  ['logo-120.png', 120, true],
  ['logo-512.png', 512, true],
]) {
  let image = sharp(square).resize(size, size, { kernel: 'lanczos3' });
  if (round) image = sharp(await image.png().toBuffer()).composite([{ input: rounded(size), blend: 'dest-in' }]);
  // A palette keeps the files small (the 512 one goes from about 570 KB to under 200) with no visible change.
  await image.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(out(name));
}
console.log('icons written');
