import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { AccountProvider } from '@/components/Account';
import AppShell from '@/components/AppShell';
import { THEME_SCRIPT } from '@/lib/theme.ts';
import './globals.css';

// One display face for the big answer and the headings; everything else is the phone's own type.
const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-display', axes: ['opsz'] });

export const metadata: Metadata = {
  title: { default: 'SoL Shuttle', template: '%s · SoL Shuttle' },
  description: 'When to leave for the SoL Tempe shuttle, planned around your classes.',
  appleWebApp: { capable: true, title: 'Shuttle', statusBarStyle: 'default' },
  // The ?v= makes browsers fetch the new logo instead of a copy of the old one they kept.
  icons: { apple: '/apple-touch-icon.png?v=2', icon: '/icon-192.png?v=2' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1220' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets an attribute on <html> before React wakes up, which is expected, not a mismatch.
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AccountProvider>
          <AppShell>{children}</AppShell>
        </AccountProvider>
        <Analytics />
      </body>
    </html>
  );
}
