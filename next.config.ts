import type { NextConfig } from 'next';

/** The app's one real address. An installed app, its sign-in and its alerts all belong to it. */
const HOME = 'https://solshuttle.app';

const config: NextConfig = {
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
