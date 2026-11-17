import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SoL Shuttle',
    short_name: 'Shuttle',
    description: 'When to leave for the SoL Tempe shuttle, planned around your classes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f6fb',
    theme_color: '#f5f6fb',
    icons: [
      { src: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png' },
    ],
  };
}
