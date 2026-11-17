'use client';

import { LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { moveTo, pointAt, stretch, turnToward } from '@/lib/motion.ts';
import { onThemeChange, showingDark } from '@/lib/theme.ts';
import { extendTrail, type TrailPoint } from '@/lib/trail.ts';
import type { Ping, Route } from '@/lib/types.ts';
import type { BusOverlay, BusPose } from './bus3d';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const FALLBACK_CENTER: [number, number] = [-111.918, 33.418];
/** Off the route there's no road to follow, so the bus slides straight to the new spot. */
const SLIDE_MS = 1_500;
/** A drive along the route lasts about as long as the gap between updates, so the bus keeps moving. */
const DRIVE_MS = { fallback: 15_000, min: 6_000, max: 20_000 };
const MOVING_MPH = 4;
const MPS_PER_MPH = 0.447;
/** The position is a few seconds old when it arrives. Carry a moving bus forward by that much, up to this. */
const MAX_LEAD_S = 6;
const REDRAW_MS = 250;
/** Close enough to watch the bus drive past the buildings, wide enough to see the next turn. */
const FOLLOW = { zoom: 16.3, pitch: 58 };
const OVERVIEW_PITCH = 38;
const FOLLOW_KEY = 'shuttle.follow';
const ROUTE_PADDING = { top: 64, bottom: 44, left: 40, right: 40 };
/** How much road behind the bus stays drawn. */
const TRAIL_M = 650;
const EMPTY_LINE = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] } };

// The bundler breaks MapLibre's own worker lookup, so the file is served from public/ instead.
setWorkerUrl('/maplibre-gl-worker.mjs');

type Props = {
  route: Route;
  ping: Ping | null;
  live: boolean;
  /** Metres along the loop, when the bus is on it. */
  s: number | null;
  /** How old the position was when it was fetched. */
  ageMs: number;
  /** The stop the next ride is caught at: its label stands out and the road up to it is lit. */
  focusStopId: string | null;
  /** The bus is on streets it doesn't usually take. */
  detour: boolean;
  /** Where on the loop it was last seen, which on a detour is where it left. */
  lastS: number | null;
  /** The last few reported positions, oldest first. */
  recent: TrailPoint[];
};

// The flat bus, seen from above. It's what shows until the 3D one is ready, and if it never is.
const BUS_SVG = `
<svg viewBox="0 0 26 46" width="26" height="46" aria-hidden="true">
  <rect class="bus-body" x="3" y="3" width="20" height="40" rx="6" />
  <path class="bus-glass" d="M6.5 8.6c0-1.6 1.2-2.6 2.8-2.6h7.4c1.6 0 2.8 1 2.8 2.6V12h-13z" />
  <rect class="bus-roof" x="6.5" y="15" width="13" height="20" rx="3" />
  <rect class="bus-vent" x="10" y="21" width="6" height="8" rx="1.5" />
  <rect class="bus-glass" x="7.5" y="38" width="11" height="2.6" rx="1.3" />
</svg>`;

type Rgb = [number, number, number];

/** MapLibre can't parse oklch(), so a token is resolved through a canvas into plain sRGB numbers. */
function token(name: string): Rgb {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const paint = (colour: Rgb, alpha = 1) => `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;

/** Strong where the bus is, fading away along the line. `from` and `to` are the opacities at each end. */
function fade(colour: Rgb, from: number, to: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['line-progress'], 0, paint(colour, from), 1, paint(colour, to)];
}

function stopsGeoJson(route: Route, focusStopId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: route.stops.map((stop) => ({
      type: 'Feature' as const,
      properties: { name: stop.name, focus: stop.id === focusStopId },
      geometry: { type: 'Point' as const, coordinates: [stop.lng, stop.lat] },
    })),
  };
}

function forward(a: number, b: number, length: number): number {
  return (((b - a) % length) + length) % length;
}

export default function ShuttleMap({ route, ping, live, s, ageMs, focusStopId, detour, lastS, recent }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const labels = useRef<Record<string, HTMLElement>>({});
  /** Where the bus is drawn: along the loop when it's on it, and as a coordinate either way. */
  const shownS = useRef<number | null>(null);
  const shownAt = useRef<[number, number] | null>(null);
  const rotation = useRef(0);
  const pose = useRef<BusPose | null>(null);
  const trail = useRef<TrailPoint[]>([]);
  const frame = useRef(0);
  const lastUpdate = useRef<number | null>(null);
  const drawn = useRef({ ahead: 0, trail: 0 });
  const overlay = useRef<BusOverlay | null>(null);
  const userMoved = useRef(false);
  /** Following keeps the bus centred and close up; otherwise the whole route stays in view. */
  const [following, setFollowing] = useState(false);
  const follow = useRef(false);
  // The newest props, for code that runs from the map's own events and animation frames.
  const now = useRef({ focusStopId, live, detour, lastS, recent });
  now.current = { focusStopId, live, detour, lastS, recent };

  const length = route.path.length > 1 ? route.path[route.path.length - 1].s : 0;

  /** Lights the road from the bus to the stop being waited at. Nothing when it's already there. */
  function drawAhead(force = false) {
    const source = map.current?.getSource('ahead') as GeoJSONSource | undefined;
    if (!source) return;
    const time = performance.now();
    if (!force && time - drawn.current.ahead < REDRAW_MS) return;
    drawn.current.ahead = time;
    const state = now.current;
    const stop = route.stops.find((x) => x.id === state.focusStopId);
    // Off its route, the road still to come is the usual one from where the bus left it.
    const from = state.detour ? state.lastS : shownS.current;
    if (!stop || from === null || !state.live || length === 0) return source.setData(EMPTY_LINE);
    const gap = forward(from, stop.s, length);
    // Parked at the stop, the bus sits just past its start: that is "here", not a whole loop away.
    const atStop = gap < 30 || gap > length - (stop.holdM ?? 50) - 30;
    source.setData(atStop ? EMPTY_LINE : { ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: stretch(route.path, from, stop.s) } });
  }

  function drawTrail(force = false) {
    const source = map.current?.getSource('trail') as GeoJSONSource | undefined;
    if (!source) return;
    const time = performance.now();
    if (!force && time - drawn.current.trail < REDRAW_MS) return;
    drawn.current.trail = time;
    const line = now.current.live && trail.current.length > 1 ? trail.current : [];
    source.setData({ ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: line } });
  }

  /** The road the bus has just come along, for when it first appears or reappears somewhere new. */
  function seedTrail(at: number | null) {
    if (at !== null && length > 0) trail.current = stretch(route.path, at - Math.min(TRAIL_M, length / 2), at);
    else trail.current = now.current.recent.slice(-12);
  }

  /** Moves everything that shows the bus: the 3D model, the flat marker under it, the camera, the trail. */
  function show(position: [number, number], force = false) {
    shownAt.current = position;
    marker.current?.setLngLat(position).setRotation(rotation.current);
    const el = marker.current?.getElement();
    pose.current = { lng: position[0], lat: position[1], bearing: rotation.current, live: now.current.live, moving: el?.dataset.moving === 'true' };
    trail.current = extendTrail(trail.current, position, TRAIL_M);
    // Following moves the map, which redraws the bus with it. Otherwise only the bus's own layer is redrawn.
    if (follow.current) map.current?.setCenter(position);
    else overlay.current?.draw();
    drawTrail(force);
    drawAhead(force);
  }

  function placeOnRoute(at: number, force = false) {
    const point = pointAt(route.path, at);
    rotation.current = turnToward(rotation.current, point.bearing);
    shownS.current = at;
    show([point.lng, point.lat], force);
  }

  function setFollow(on: boolean, remember = true) {
    follow.current = on;
    setFollowing(on);
    if (remember) {
      try {
        localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
      } catch {
        // Private browsing: the choice lasts for this visit.
      }
    }
    const instance = map.current;
    if (!instance) return;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
    if (on && shownAt.current) {
      instance.easeTo({ center: shownAt.current, ...FOLLOW, duration });
    } else if (!on && route.path.length > 1) {
      const bounds = new LngLatBounds();
      route.path.forEach((p) => bounds.extend([p.lng, p.lat]));
      instance.fitBounds(bounds, { padding: ROUTE_PADDING, pitch: OVERVIEW_PITCH, duration });
    }
  }

  /** Applies whether the bus is on or off its usual route to the lines: off it, both change colour. */
  function colourLines() {
    const instance = map.current;
    if (!instance?.getLayer('trail')) return;
    const off = now.current.detour;
    const wake = token(off ? '--detour' : '--bus-blue');
    const road = token(off ? '--detour' : '--bus-orange');
    instance.setPaintProperty('trail', 'line-gradient', fade(wake, 0, 0.9));
    instance.setPaintProperty('ahead', 'line-gradient', fade(road, off ? 0.75 : 1, off ? 0.2 : 0.38));
    instance.setPaintProperty('ahead-glow', 'line-color', paint(road, off ? 0.12 : 0.2));
  }

  useEffect(() => {
    if (!container.current) return;
    let dark = showingDark();
    let disposed = false;
    // Framed from the start: 'load' waits for every tile, which is a long time on a slow connection.
    const bounds = new LngLatBounds();
    route.path.forEach((p) => bounds.extend([p.lng, p.lat]));
    const framing = route.path.length > 1 ? { bounds, fitBoundsOptions: { padding: ROUTE_PADDING } } : { center: FALLBACK_CENTER, zoom: 13 };
    const instance = new MapLibre({
      container: container.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      ...framing,
      pitch: OVERVIEW_PITCH,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      // On a phone the map is most of a screen tall. One finger has to scroll the page past it,
      // so moving the map takes two. With a mouse, drag and wheel work as usual.
      cooperativeGestures: matchMedia('(pointer: coarse)').matches,
    });
    instance.touchZoomRotate.disableRotation();
    instance.on('dragstart', () => {
      userMoved.current = true;
      // Moving the map by hand means looking somewhere else: stop pulling it back to the bus.
      if (follow.current) {
        follow.current = false;
        setFollowing(false);
      }
    });

    // Stop names sit above their dots as page elements, so they stay sharp and use the app's type.
    labels.current = {};
    const stopMarkers = route.stops.map((stop) => {
      const el = document.createElement('div');
      el.className = 'stop-label';
      el.textContent = stop.name;
      el.dataset.focus = String(stop.id === now.current.focusStopId);
      labels.current[stop.id] = el;
      // High enough that the bus, sitting on the stop, doesn't cover the name.
      return new Marker({ element: el, anchor: 'bottom', offset: [0, -30] }).setLngLat([stop.lng, stop.lat]).addTo(instance);
    });

    /** Everything drawn over the base map. Runs again whenever the base map is swapped for the other theme. */
    // Start the credit folded behind its (i) button so it doesn't cover the phone-sized map.
    const foldCredit = () => container.current?.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
    // The control opens itself once the map has drawn, so it's folded again after each of the first signs of life.
    for (const sign of ['load', 'idle', 'render'] as const) instance.once(sign, foldCredit);

    /**
     * Repaints the base map in the app's own colours. The stock light style is fine but anonymous,
     * and the stock dark one is so dark its streets disappear.
     */
    function tint() {
      const c = {
        bg: paint(token('--map-bg')),
        road: paint(token('--map-road')),
        edge: paint(token('--map-road-edge')),
        water: paint(token('--map-water')),
        green: paint(token('--map-green')),
        label: paint(token('--map-label')),
        building: paint(token('--map-building')),
      };
      const set = (id: string, property: string, value: string) => {
        try {
          instance.setPaintProperty(id, property as Parameters<MapLibre["setPaintProperty"]>[1], value);
        } catch {
          // A layer that doesn't take this property keeps its own colour.
        }
      };
      for (const layer of instance.getStyle().layers) {
        const from = 'source-layer' in layer ? layer['source-layer'] : undefined;
        if (layer.type === 'background') set(layer.id, 'background-color', c.bg);
        else if (layer.type === 'line' && (from === 'transportation' || from === 'aeroway')) set(layer.id, 'line-color', /casing|outline/.test(layer.id) ? c.edge : c.road);
        else if (layer.type === 'fill' && from === 'transportation') set(layer.id, 'fill-color', c.road);
        else if (layer.type === 'fill' && from === 'water') set(layer.id, 'fill-color', c.water);
        else if (layer.type === 'line' && from === 'waterway') set(layer.id, 'line-color', c.water);
        else if (layer.type === 'fill' && (from === 'park' || from === 'landcover')) set(layer.id, 'fill-color', c.green);
        else if (layer.type === 'fill' && from === 'landuse') set(layer.id, 'fill-color', c.bg);
        else if (layer.type === 'fill' && from === 'building') set(layer.id, 'fill-color', c.building);
        else if (layer.type === 'line' && from === 'boundary') set(layer.id, 'line-color', c.edge);
        else if (layer.type === 'symbol') {
          set(layer.id, 'text-color', c.label);
          set(layer.id, 'text-halo-color', c.bg);
        }
      }
    }

    function decorate() {
      foldCredit();
      if (instance.getSource('stops')) return;
      tint();
      const line = token('--map-route');
      const edge = token('--map-edge');
      const orange = token('--bus-orange');
      const round = { 'line-join': 'round' as const, 'line-cap': 'round' as const };
      // Lines go under the street names, so the names stay readable on top of them.
      const under = instance.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;

      if (instance.getSource('openmaptiles')) {
        instance.addLayer(
          {
            id: 'buildings-3d',
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: 14.5,
            paint: {
              'fill-extrusion-color': paint(token('--map-building')),
              'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.6, ['coalesce', ['get', 'render_height'], 6]],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.82,
            },
          },
          under,
        );
      }

      if (route.path.length > 1) {
        instance.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.path.map((p) => [p.lng, p.lat]) } },
        });
        // A pale edge lifts the line off the streets beneath it.
        instance.addLayer({ id: 'route-edge', type: 'line', source: 'route', layout: round, paint: { 'line-color': paint(edge, 0.9), 'line-width': 9 } }, under);
        instance.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': paint(line), 'line-width': 4.5 } }, under);
        // Gradients along a line need the source to measure it.
        instance.addSource('ahead', { type: 'geojson', lineMetrics: true, data: EMPTY_LINE });
        instance.addLayer({ id: 'ahead-glow', type: 'line', source: 'ahead', layout: round, paint: { 'line-color': paint(orange, 0.2), 'line-width': 16, 'line-blur': 6 } }, under);
        instance.addLayer({ id: 'ahead', type: 'line', source: 'ahead', layout: round, paint: { 'line-width': 6, 'line-gradient': fade(orange, 1, 0.38) } }, under);
      }
      instance.addSource('trail', { type: 'geojson', lineMetrics: true, data: EMPTY_LINE });
      instance.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: round, paint: { 'line-width': 8, 'line-gradient': fade(token('--bus-blue'), 0, 0.9) } }, under);

      instance.addSource('stops', { type: 'geojson', data: stopsGeoJson(route, now.current.focusStopId) });
      instance.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'focus'], 8, 6],
          'circle-color': paint(edge),
          'circle-stroke-color': ['case', ['get', 'focus'], paint(orange), paint(line)],
          'circle-stroke-width': 3.5,
          'circle-pitch-alignment': 'map',
        },
      });

      // The 3D bus arrives a moment later; until then (and if it can't be made) the flat one shows.
      overlay.current?.remove();
      overlay.current = null;
      marker.current?.getElement().removeAttribute('data-model');
      const colours = {
        blue: paint(token('--bus-blue')),
        orange: paint(token('--bus-orange')),
        glass: paint(token('--bus-glass-3d')),
        trim: paint(token('--bus-trim')),
        halo: paint(token('--bus-halo')),
      };
      import('./bus3d')
        .then(({ createBusOverlay }) => {
          if (disposed || instance.getLayer('bus-3d')) return;
          overlay.current = createBusOverlay(instance, 'bus-3d', () => pose.current, colours);
          instance.addLayer(overlay.current.layer);
          marker.current?.getElement().setAttribute('data-model', '3d');
        })
        .catch((error) => console.error('3D bus unavailable, keeping the flat one', error));

      colourLines();
      drawAhead(true);
      drawTrail(true);
    }
    instance.on('style.load', decorate);

    const stopThemeWatch = onThemeChange(() => {
      const next = showingDark();
      if (next === dark) return;
      dark = next;
      instance.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    });

    map.current = instance;
    // For poking at the map from the console while developing.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { shuttleMap?: MapLibre }).shuttleMap = instance;
    return () => {
      disposed = true;
      stopThemeWatch();
      cancelAnimationFrame(frame.current);
      stopMarkers.forEach((m) => m.remove());
      overlay.current?.remove();
      overlay.current = null;
      instance.remove();
      map.current = null;
      marker.current = null;
      pose.current = null;
      trail.current = [];
      shownS.current = null;
      shownAt.current = null;
      lastUpdate.current = null;
    };
    // The map is built once; props below update it in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    const source = map.current?.getSource('stops') as GeoJSONSource | undefined;
    source?.setData(stopsGeoJson(route, focusStopId));
    for (const [id, el] of Object.entries(labels.current)) el.dataset.focus = String(id === focusStopId);
    colourLines();
    drawAhead(true);
    drawTrail(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, focusStopId, live, detour, lastS]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ping) return;
    const here: [number, number] = [ping.lng, ping.lat];
    const moving = live && ping.mph >= MOVING_MPH;
    const first = !marker.current;

    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'bus';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Shuttle position');
      el.innerHTML = `<span class="bus-halo"></span>${BUS_SVG}`;
      if (overlay.current) el.dataset.model = '3d';
      marker.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(here).addTo(instance);
      rotation.current = ping.heading;
      marker.current.setRotation(rotation.current);
      shownAt.current = here;
      if (route.path.length < 2) instance.jumpTo({ center: here, zoom: 14 });
      let wanted = false;
      try {
        wanted = localStorage.getItem(FOLLOW_KEY) === '1';
      } catch {
        // No saved choice.
      }
      if (wanted) {
        follow.current = true;
        setFollowing(true);
        instance.jumpTo({ center: here, ...FOLLOW });
      }
    }
    const el = marker.current.getElement();
    el.dataset.live = String(live);
    el.dataset.moving = String(moving);

    const started = performance.now();
    const sinceLast = lastUpdate.current === null ? DRIVE_MS.fallback : started - lastUpdate.current;
    lastUpdate.current = started;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(frame.current);

    if (s !== null && length > 0) {
      // On the loop: drive along the road to where the bus is now, never cutting corners.
      const lead = moving ? ping.mph * MPS_PER_MPH * Math.min(MAX_LEAD_S, ageMs / 1000) : 0;
      const target = s + lead;
      const move = moveTo(shownS.current, target, length);
      if (move.kind === 'jump' || (move.kind === 'glide' && reduced)) {
        if (move.kind === 'jump' || first) seedTrail(target);
        placeOnRoute(target, true);
      } else if (move.kind === 'glide') {
        const from = shownS.current!;
        const duration = Math.min(DRIVE_MS.max, Math.max(DRIVE_MS.min, sinceLast));
        const step = (time: number) => {
          // Steady speed, like the bus: easing would make it lurch at every update.
          const progress = Math.min(1, Math.max(0, (time - started) / duration));
          placeOnRoute(from + move.metres * progress, progress === 1);
          if (progress < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      } else {
        show(shownAt.current ?? here, true);
      }
    } else {
      // Off the loop (or no loop learned yet): slide straight to the reported spot.
      const wasOnRoute = shownS.current !== null;
      shownS.current = null;
      if (first || (trail.current.length === 0 && !wasOnRoute)) seedTrail(null);
      if (moving) rotation.current = turnToward(rotation.current, ping.heading);
      const start = shownAt.current ?? here;
      if (reduced) {
        show(here, true);
      } else {
        const step = (time: number) => {
          const progress = Math.min(1, Math.max(0, (time - started) / SLIDE_MS));
          const eased = 1 - (1 - progress) ** 4;
          show([start[0] + (here[0] - start[0]) * eased, start[1] + (here[1] - start[1]) * eased], progress === 1);
          if (progress < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      }
      if (route.path.length < 2 && !userMoved.current) instance.easeTo({ center: here, duration: SLIDE_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping, s, live, route]);

  return (
    <>
      <div ref={container} className="map" />
      {ping && (
        <button className="map-toggle" aria-pressed={following} onClick={() => setFollow(!following)}>
          {following ? 'Whole route' : 'Follow bus'}
        </button>
      )}
    </>
  );
}
