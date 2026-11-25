import type { NextConfig } from 'next';

/** The app's one real address. An installed app, its sign-in and its alerts all belong to it. */
const HOME = 'https://solshuttle.app';
const dev = process.env.NODE_ENV !== 'production';

/**
 * What a page may load and talk to. Scripts, styles, fonts and the visit counter are the app's own;
 * the only other address is the map tiles. Next puts small inline scripts in every page, so inline
 * scripts are allowed, but nothing from another site is, and no other site may frame the app.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://tiles.openfreemap.org${dev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  // Older browsers that don't read frame-ancestors: never show the app inside another site.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Location only for the app itself (Going now), and nothing else it never uses.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Once a browser has seen the app over HTTPS, it never tries plain HTTP for it again.
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // Answers about a person must never be kept by a shared cache between them and the app.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
  async redirects() {
    // Pages opened at an old or alternate address are sent to the real one, so nobody signs in or
    // installs the app somewhere their alerts won't follow. The API is left alone: installs made
    // at the old address keep working until their owners move.
    return ['alyan-sol-shuttle.vercel.app', 'www.solshuttle.app'].map((host) => ({
      source: '/:path((?!api/|sw\\.js).*)',
      has: [{ type: 'host' as const, value: host }],
      destination: `${HOME}/:path`,
      permanent: false,
    }));
  },
};

export default config;
