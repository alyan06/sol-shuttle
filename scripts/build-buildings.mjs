// Builds lib/buildings.json: the Tempe campus buildings a class can meet in, from ASU's own public
// campus map service. Run it again when the campus changes: node scripts/build-buildings.mjs
import { writeFile } from 'node:fs/promises';

const SOURCE =
  'https://gis.m.asu.edu/server/rest/services/Campus/CampusBuilding/MapServer/0/query' +
  '?where=BLDG_CITY%3D%27TEMPE%27&outFields=BLDG_NAME,BLDG_CODE,Type&returnGeometry=true&outSR=4326&geometryPrecision=5&f=json';

/** Not places anyone has a class, a job or a meeting in. */
const SKIP = /STORAGE|PARKING|GARAGE|\bPLANT\b|TUNNEL|RESTROOM|\bSHED\b|TRASH|MAINTENANCE|OUTDOOR ROOM|\bYARD\b|UTILITIES|THERMAL|ICE PRODUCTION|PEDESTRIAN BRIDGE|RAMADA|PUMP HOUSE|TOILETS|MAIL FACILITY|CHEMICAL|T-FRAME|ZERO WASTE|SUPPORT$/;
const SMALL = new Set(['and', 'of', 'for', 'the', 'at', 'on', 'in', 'del']);
const UPPER = new Set(['ASU', 'II', 'III', 'IV', 'V', 'FM', 'SDS', 'GLV', 'MTW', 'ISTBX', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

function titleCase(raw) {
  const words = raw
    .replace(/^HAV- /, 'Hassayampa ')
    .replace(/\bBLDG\.?(?=\s|$)/g, 'Building')
    .replace(/\s*@\s*/g, ' at ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  return words
    .map((word, index) => {
      const bare = word.replace(/[().,]/g, '');
      if (UPPER.has(bare.toUpperCase()) && bare.length <= 5 && bare === bare.toUpperCase()) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (index > 0 && SMALL.has(lower)) return lower;
      // McClintock, McCord, McAllister.
      return lower.replace(/(^|[\s(\-/&])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase()).replace(/^Mc([a-z])/, (_, letter) => `Mc${letter.toUpperCase()}`);
    })
    .join(' ');
}

function centre(rings) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return { lat: Number(((south + north) / 2).toFixed(5)), lng: Number(((west + east) / 2).toFixed(5)) };
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`ASU map service answered ${res.status}`);
const { features } = await res.json();

const byName = new Map();
for (const feature of features) {
  const { BLDG_NAME: name, BLDG_CODE: code } = feature.attributes;
  const rings = feature.geometry?.rings;
  if (!name || !code || !rings?.length || SKIP.test(name) || /^\(/.test(name) || /^X?\d/.test(code)) continue;
  const shown = titleCase(name);
  if (byName.has(shown)) continue;
  byName.set(shown, { code, name: shown, ...centre(rings) });
}

const buildings = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
await writeFile(new URL('../lib/buildings.json', import.meta.url), `${JSON.stringify(buildings)}\n`);
console.log(`${buildings.length} buildings written to lib/buildings.json`);
