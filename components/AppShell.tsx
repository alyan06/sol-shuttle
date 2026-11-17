'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TABS = [
  {
    href: '/',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="5" y="3.5" width="14" height="14" rx="3.5" />
        <path d="M5 11.5h14M8.5 20.5v-3M15.5 20.5v-3" />
        <circle cx="8.8" cy="14.4" r="0.6" />
        <circle cx="15.2" cy="14.4" r="0.6" />
      </svg>
    ),
  },
  {
    href: '/schedule',
    label: 'Classes',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" />
        <circle cx="15" cy="7.5" r="2" />
        <circle cx="9" cy="16.5" r="2" />
      </svg>
    ),
  },
];

/** The bus, small: the app's mark. */
export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 28" aria-hidden>
      <rect className="mark-body" x="3" y="6" width="22" height="15" rx="4.5" />
      <rect className="mark-stripe" x="3" y="14.5" width="22" height="3" />
      <rect className="mark-glass" x="6" y="9" width="5.5" height="4" rx="1" />
      <rect className="mark-glass" x="13" y="9" width="9" height="4" rx="1" />
      <circle className="mark-wheel" cx="9" cy="21.5" r="2.4" />
      <circle className="mark-wheel" cx="19" cy="21.5" r="2.4" />
    </svg>
  );
}

export function TopBar({ title = 'SoL Shuttle', children }: { title?: string; children?: ReactNode }) {
  return (
    <header className="top">
      <Link className="brand" href="/" aria-label="SoL Shuttle, today">
        <Mark />
        <span>{title}</span>
      </Link>
      {children}
    </header>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      {children}
      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="tab" aria-current={pathname === tab.href ? 'page' : undefined}>
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
