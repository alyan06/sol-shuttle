// Keeps the served map worker in step with the installed maplibre-gl version.
import { copyFileSync } from 'node:fs';

copyFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/maplibre-gl-worker.mjs');
