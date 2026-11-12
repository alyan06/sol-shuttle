'use client';

import { LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { moveTo, pointAt, stretch, turnToward } from '@/lib/motion.ts';
import type { Ping, Route } from '@/lib/types.ts';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const FALLBACK_CENTER: [number, number] = [-111.918, 33.418];
/** Off the route there's no road to follow, so the marker slides straight to the new spot. */
const SLIDE_MS = 1_500;
/** A drive along the route lasts about as long as the gap between updates, so the bus keeps moving. */
const DRIVE_MS = { fallback: 15_000, min: 6_000, max: 20_000 };
const MOVING_MPH = 4;
const MPS_PER_MPH = 0.447;
/** The position is a few seconds old when it arrives. Carry a moving bus forward by that much, up to this. */
const MAX_LEAD_S = 6;
const AHEAD_REDRAW_MS = 400;
/** Close enough to see the bus drive, wide enough to see the next turn. */
const FOLLOW_ZOOM = 15.6;
const FOLLOW_KEY = 'shuttle.follow';
const ROUTE_PADDING = { top: 72, bottom: 40, left: 44, right: 44 };
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
};

// Seen from above, nose up: blue body, orange roof, glass at the front and back.
const BUS_SVG = `
<svg viewBox="0 0 26 46" width="26" height="46" aria-hidden="true">
  <rect class="bus-body" x="3" y="3" width="20" height="40" rx="6" />
  <path class="bus-glass" d="M6.5 8.6c0-1.6 1.2-2.6 2.8-2.6h7.4c1.6 0 2.8 1 2.8 2.6V12h-13z" />
  <rect class="bus-roof" x="6.5" y="15" width="13" height="20" rx="3" />
  <rect class="bus-vent" x="10" y="21" width="6" height="8" rx="1.5" />
  <rect class="bus-glass" x="7.5" y="38" width="11" height="2.6" rx="1.3" />
</svg>`;

function cssColor(name: string): string {
  // MapLibre can't parse oklch(), so resolve the token through a canvas into sRGB.
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
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

export default function ShuttleMap({ route, ping, live, s, ageMs, focusStopId }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const labels = useRef<Record<string, HTMLElement>>({});
  /** Where the marker is drawn: along the loop when it's on it, and as a coordinate either way. */
  const shownS = useRef<number | null>(null);
  const shownAt = useRef<[number, number] | null>(null);
  const rotation = useRef(0);
  const frame = useRef(0);
  const lastUpdate = useRef<number | null>(null);
  const aheadDrawn = useRef(0);
  const focus = useRef(focusStopId);
  const isLive = useRef(live);
  const userMoved = useRef(false);
  /** Following keeps the bus centred and close up; otherwise the whole route stays in view. */
  const [following, setFollowing] = useState(false);
  const follow = useRef(false);
  focus.current = focusStopId;
  isLive.current = live;

  const length = route.path.length > 1 ? route.path[route.path.length - 1].s : 0;

  /** Lights the road from the bus to the stop being waited at. Nothing when it's already there. */
  function drawAhead(force = false) {
    const source = map.current?.getSource('ahead') as GeoJSONSource | undefined;
    if (!source) return;
    const now = performance.now();
    if (!force && now - aheadDrawn.current < AHEAD_REDRAW_MS) return;
    aheadDrawn.current = now;
    const stop = route.stops.find((x) => x.id === focus.current);
    const from = shownS.current;
    if (!stop || from === null || !isLive.current || length === 0) return source.setData(EMPTY_LINE);
    const gap = forward(from, stop.s, length);
    // Parked at the stop, the bus sits just past its start: that is "here", not a whole loop away.
    const atStop = gap < 30 || gap > length - (stop.holdM ?? 50) - 30;
    source.setData(atStop ? EMPTY_LINE : { ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: stretch(route.path, from, stop.s) } });
  }

  function placeOnRoute(at: number, force = false) {
    const point = pointAt(route.path, at);
    rotation.current = turnToward(rotation.current, point.bearing);
    marker.current?.setLngLat([point.lng, point.lat]).setRotation(rotation.current);
    shownS.current = at;
    shownAt.current = [point.lng, point.lat];
    if (follow.current) map.current?.setCenter(shownAt.current);
    drawAhead(force);
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
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700;
    if (on && shownAt.current) {
      instance.easeTo({ center: shownAt.current, zoom: FOLLOW_ZOOM, duration });
    } else if (!on && route.path.length > 1) {
      const bounds = new LngLatBounds();
      route.path.forEach((p) => bounds.extend([p.lng, p.lat]));
      instance.fitBounds(bounds, { padding: ROUTE_PADDING, duration });
    }
  }

  useEffect(() => {
    if (!container.current) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    // Framed from the start: 'load' waits for every tile, which is a long time on a slow connection.
    const bounds = new LngLatBounds();
    route.path.forEach((p) => bounds.extend([p.lng, p.lat]));
    const framing =
      route.path.length > 1 ? { bounds, fitBoundsOptions: { padding: ROUTE_PADDING } } : { center: FALLBACK_CENTER, zoom: 13 };
    const instance = new MapLibre({
      container: container.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      ...framing,
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
      el.dataset.focus = String(stop.id === focus.current);
      labels.current[stop.id] = el;
      // High enough that the bus, sitting on the stop, doesn't cover the name.
      return new Marker({ element: el, anchor: 'bottom', offset: [0, -27] }).setLngLat([stop.lng, stop.lat]).addTo(instance);
    });

    instance.on('load', () => {
      // Start the credit folded behind its (i) button so it doesn't cover the phone-sized map.
      container.current?.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      const primary = cssColor('--primary');
      const surface = cssColor('--bg');
      const orange = cssColor('--bus-orange');
      const round = { 'line-join': 'round' as const, 'line-cap': 'round' as const };

      if (route.path.length > 1) {
        instance.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.path.map((p) => [p.lng, p.lat]) } },
        });
        // A pale edge lifts the line off the streets beneath it.
        instance.addLayer({ id: 'route-edge', type: 'line', source: 'route', layout: round, paint: { 'line-color': surface, 'line-width': 8, 'line-opacity': 0.85 } });
        instance.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': primary, 'line-width': 4, 'line-opacity': 0.7 } });
        instance.addSource('ahead', { type: 'geojson', data: EMPTY_LINE });
        instance.addLayer({ id: 'ahead', type: 'line', source: 'ahead', layout: round, paint: { 'line-color': orange, 'line-width': 5 } });
      }

      instance.addSource('stops', { type: 'geojson', data: stopsGeoJson(route, focus.current) });
      instance.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'focus'], 7, 5],
          'circle-color': surface,
          'circle-stroke-color': ['case', ['get', 'focus'], orange, primary],
          'circle-stroke-width': 3,
        },
      });
      drawAhead(true);
    });

    map.current = instance;
    return () => {
      cancelAnimationFrame(frame.current);
      stopMarkers.forEach((m) => m.remove());
      instance.remove();
      map.current = null;
      marker.current = null;
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
    drawAhead(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, focusStopId, live]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ping) return;
    const here: [number, number] = [ping.lng, ping.lat];
    const moving = live && ping.mph >= MOVING_MPH;

    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'bus';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Shuttle position');
      el.innerHTML = `<span class="bus-halo"></span>${BUS_SVG}`;
      marker.current = new Marker({ element: el, rotationAlignment: 'map' }).setLngLat(here).addTo(instance);
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
        instance.jumpTo({ center: here, zoom: FOLLOW_ZOOM });
      }
    }
    const el = marker.current.getElement();
    el.dataset.live = String(live);
    el.dataset.moving = String(moving);

    const now = performance.now();
    const sinceLast = lastUpdate.current === null ? DRIVE_MS.fallback : now - lastUpdate.current;
    lastUpdate.current = now;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(frame.current);

    if (s !== null && length > 0) {
      // On the loop: drive along the road to where the bus is now, never cutting corners.
      const lead = moving ? ping.mph * MPS_PER_MPH * Math.min(MAX_LEAD_S, ageMs / 1000) : 0;
      const target = s + lead;
      const move = moveTo(shownS.current, target, length);
      if (move.kind === 'jump' || (move.kind === 'glide' && reduced)) {
        placeOnRoute(target, true);
      } else if (move.kind === 'glide') {
        const from = shownS.current!;
        const duration = Math.min(DRIVE_MS.max, Math.max(DRIVE_MS.min, sinceLast));
        const step = (time: number) => {
          // Steady speed, like the bus: easing would make it lurch at every update.
          const progress = Math.min(1, (time - now) / duration);
          placeOnRoute(from + move.metres * progress, progress === 1);
          if (progress < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      } else {
        drawAhead(true);
      }
    } else {
      // Off the loop (or no loop learned yet): slide straight to the reported spot.
      shownS.current = null;
      if (moving) rotation.current = turnToward(rotation.current, ping.heading);
      marker.current.setRotation(rotation.current);
      const start = shownAt.current ?? here;
      if (reduced) {
        marker.current.setLngLat(here);
        shownAt.current = here;
      } else {
        const step = (time: number) => {
          const progress = Math.min(1, (time - now) / SLIDE_MS);
          const eased = 1 - (1 - progress) ** 4;
          const position: [number, number] = [start[0] + (here[0] - start[0]) * eased, start[1] + (here[1] - start[1]) * eased];
          marker.current?.setLngLat(position);
          shownAt.current = position;
          if (follow.current) map.current?.setCenter(position);
          if (progress < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      }
      drawAhead(true);
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
