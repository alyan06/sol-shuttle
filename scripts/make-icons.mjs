// Draws the app icon: a clock dial with one brass hand, on the app's steel blue.
import sharp from 'sharp';

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" fill="#1c6878"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#ffffff" stroke-width="30"/>
  <path d="M256 256V160" stroke="#ffffff" stroke-width="30" stroke-linecap="round"/>
  <path d="M256 256l74 44" stroke="#eaa52c" stroke-width="30" stroke-linecap="round"/>
</svg>`;

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(Buffer.from(svg(size))).png().toFile(new URL(`../public/${name}`, import.meta.url).pathname.slice(1));
}
console.log('icons written');
