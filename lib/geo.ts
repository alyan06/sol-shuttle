const M_PER_DEG_LAT = 111_320;

type LatLng = { lat: number; lng: number };

export function metresBetween(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * M_PER_DEG_LAT * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(x, y);
}

export function bearing(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = b.lat - a.lat;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Closest point on segment a-b to p: the fraction along the segment and the distance in metres. */
export function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): { fraction: number; distanceM: number } {
  const k = Math.cos(p.lat * (Math.PI / 180));
  const ax = (a.lng - p.lng) * k;
  const ay = a.lat - p.lat;
  const dx = (b.lng - p.lng) * k - ax;
  const dy = b.lat - p.lat - ay;
  const len2 = dx * dx + dy * dy;
  const fraction = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const distanceM = Math.hypot(ax + fraction * dx, ay + fraction * dy) * M_PER_DEG_LAT;
  return { fraction, distanceM };
}
