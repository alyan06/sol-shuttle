'use client';

import { LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { Ping, Route } from '@/lib/types.ts';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const FALLBACK_CENTER: [number, number] = [-111.918, 33.418];
const GLIDE_MS = 1_500;

// The bundler breaks MapLibre's own worker lookup, so the file is served from public/ instead.
setWorkerUrl('/maplibre-gl-worker.mjs');

type Props = { route: Route; ping: Ping | null; live: boolean; selectedStopId: string | null };

function cssColor(name: string): string {
  // MapLibre can't parse oklch(), so resolve the token through a canvas into sRGB.
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function stopsGeoJson(route: Route, selectedStopId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: route.stops.map((stop) => ({
      type: 'Feature' as const,
      properties: { name: stop.name, selected: stop.id === selectedStopId },
      geometry: { type: 'Point' as const, coordinates: [stop.lng, stop.lat] },
    })),
  };
}

export default function ShuttleMap({ route, ping, live, selectedStopId }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const arrow = useRef<HTMLDivElement | null>(null);
  const shown = useRef<[number, number] | null>(null);
  const frame = useRef(0);
  const userMoved = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    // Framed from the start: 'load' waits for every tile, which is a long time on a slow connection.
    const bounds = new LngLatBounds();
    route.path.forEach((p) => bounds.extend([p.lng, p.lat]));
    const framing = route.path.length > 1 ? { bounds, fitBoundsOptions: { padding: 36 } } : { center: FALLBACK_CENTER, zoom: 13 };
    const instance = new MapLibre({
      container: container.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      ...framing,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    instance.touchZoomRotate.disableRotation();
    instance.on('dragstart', () => {
      userMoved.current = true;
    });

    instance.on('load', () => {
      // Start the credit folded behind its (i) button so it doesn't cover the phone-sized map.
      container.current?.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      const primary = cssColor('--primary');
      const accent = cssColor('--accent');
      const surface = cssColor('--bg');

      if (route.path.length > 1) {
        instance.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.path.map((p) => [p.lng, p.lat]) },
          },
        });
        instance.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': primary, 'line-width': 4, 'line-opacity': 0.55 },
        });
      }

      instance.addSource('stops', { type: 'geojson', data: stopsGeoJson(route, selectedStopId) });
      instance.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 8, 5],
          'circle-color': ['case', ['get', 'selected'], accent, surface],
          'circle-stroke-color': primary,
          'circle-stroke-width': 2.5,
        },
      });
    });

    map.current = instance;
    return () => {
      cancelAnimationFrame(frame.current);
      instance.remove();
      map.current = null;
      marker.current = null;
      shown.current = null;
    };
    // The map is built once; props below update it in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    const source = map.current?.getSource('stops') as GeoJSONSource | undefined;
    source?.setData(stopsGeoJson(route, selectedStopId));
  }, [route, selectedStopId]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ping) return;
    const target: [number, number] = [ping.lng, ping.lat];

    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'bus-marker';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Shuttle position');
      const pointer = document.createElement('div');
      pointer.className = 'bus-marker-arrow';
      el.append(pointer);
      arrow.current = pointer;
      marker.current = new Marker({ element: el }).setLngLat(target).addTo(instance);
      shown.current = target;
      if (route.path.length < 2) instance.jumpTo({ center: target, zoom: 14 });
    }

    marker.current.getElement().dataset.live = String(live);
    if (arrow.current) {
      arrow.current.style.transform = `rotate(${ping.heading}deg)`;
      arrow.current.style.opacity = ping.mph >= 4 ? '1' : '0';
    }

    const start = shown.current ?? target;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(frame.current);
    if (reduced) {
      marker.current.setLngLat(target);
      shown.current = target;
    } else {
      const begun = performance.now();
      const step = (time: number) => {
        const progress = Math.min(1, (time - begun) / GLIDE_MS);
        const eased = 1 - (1 - progress) ** 4;
        const position: [number, number] = [
          start[0] + (target[0] - start[0]) * eased,
          start[1] + (target[1] - start[1]) * eased,
        ];
        marker.current?.setLngLat(position);
        shown.current = position;
        if (progress < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    }
    if (route.path.length < 2 && !userMoved.current) instance.easeTo({ center: target, duration: GLIDE_MS });
  }, [ping, live, route]);

  return <div ref={container} className="map" />;
}
