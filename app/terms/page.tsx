import type { Metadata } from 'next';
import Link from 'next/link';
import { TopBar } from '@/components/AppShell';

export const metadata: Metadata = { title: 'Terms' };

const UPDATED = 'November 20, 2026';

export default function TermsPage() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="page">
      <TopBar />
      <header className="page-head">
        <h1>Terms</h1>
        <p>The short rules for using SoL Shuttle (solshuttle.app). Last updated {UPDATED}.</p>
      </header>
      <article className="prose">
        <h2>What this is</h2>
        <p>
          SoL Shuttle is a free app, made and run by one SoL resident as a personal project. It is not run or endorsed by SoL, its management company, ASU or Samsara. By using it you agree to what&apos;s on this page and to the <Link href="/privacy">privacy page</Link>.
        </p>

        <h2>The times are estimates</h2>
        <p>
          Bus times are worked out from how the bus has driven before. The bus can be early, late, on a break, off its route or not running, and the tracker the app reads can stop without warning. Use your own judgement, and don&apos;t rely on the app for anything you can&apos;t afford to miss. The app comes as it is, with no promise that it will be right or available, and whoever runs it isn&apos;t responsible for a missed bus, a late arrival or anything that follows from one.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>You sign in with your own Google account. The app is meant for people who live at SoL.</li>
          <li>You must be 13 or older to use it.</li>
          <li>What you enter is yours. You can change it or delete your account at any time in Settings.</li>
          <li>Don&apos;t try to break the app, get at other people&apos;s data, or flood it with requests. An account used that way may be removed.</li>
        </ul>

        <h2>Liability</h2>
        <p>
          To the extent the law allows, whoever runs the app isn&apos;t liable for any loss or damage from using it, including missed buses, classes or appointments.
        </p>

        <h2>It may change or stop</h2>
        <p>
          This is a personal project. Features may change, and the app may be paused or shut down, for example if the bus tracker it depends on goes away. If it shuts down for good, the data kept for accounts is deleted.
        </p>

        <h2>Cost</h2>
        <p>The app is free. There are no ads and nothing to buy.</p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of Arizona.</p>

        <h2>Credits</h2>
        <p>
          Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, map tiles by <a href="https://openfreemap.org">OpenFreeMap</a> with <a href="https://openmaptiles.org">OpenMapTiles</a>. Building names and places from ASU&apos;s public campus map. Bus positions from the apartment&apos;s public Samsara tracking link.
        </p>

        <h2>Questions</h2>
        <p>
          {contact ? (
            <>
              Write to <a href={`mailto:${contact}`}>{contact}</a>.{' '}
            </>
          ) : (
            <>See the <Link href="/privacy">privacy page</Link> for how to get in touch. </>
          )}
          The date at the top changes whenever this page does.
        </p>
        <p>
          <Link href="/">Back to the bus</Link>
        </p>
      </article>
    </main>
  );
}
