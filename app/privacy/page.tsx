import type { Metadata } from 'next';
import Link from 'next/link';
import { TopBar } from '@/components/AppShell';

export const metadata: Metadata = { title: 'Privacy' };

const UPDATED = 'November 17, 2026';

export default function PrivacyPage() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="page">
      <TopBar />
      <header className="page-head">
        <h1>Privacy</h1>
        <p>What SoL Shuttle (solshuttle.app) keeps about you, why, and how to erase it. Last updated {UPDATED}.</p>
      </header>
      <article className="prose">
        <h2>Who runs this</h2>
        <p>
          SoL Shuttle is made and run by one SoL resident, an ASU student, as a personal project. It is not run by SoL, its management company, ASU or Samsara, and none of them have endorsed it. The code is public at{' '}
          <a href="https://github.com/alyan06/sol-shuttle">github.com/alyan06/sol-shuttle</a>.
        </p>

        <h2>What it keeps</h2>
        <ul>
          <li>
            <strong>Who you are.</strong> When you sign in with Google, the app receives your name, your email address and a Google account number. It never sees your password and asks Google for nothing else: no contacts, no calendar, no files.
          </li>
          <li>
            <strong>Your time on campus.</strong> The classes and other times you type in: what you call them, their days and times, the building and room.
          </li>
          <li>
            <strong>Your settings.</strong> Walk times, which alerts you want, the hours they may arrive.
          </li>
          <li>
            <strong>Where to send alerts.</strong> For each phone or computer you turn alerts on for, the address its browser gives out for notifications.
          </li>
          <li>
            <strong>Today&apos;s taps.</strong> Things like &quot;skip this class&quot; or &quot;I&apos;m on the bus&quot;, and which alerts have already gone out today. These are replaced the next day.
          </li>
        </ul>

        <h2>What your Google details are used for</h2>
        <p>
          Your name and email from Google are used for two things only: to know which account is yours when you sign in, and to show them back to you in Settings. They are not used for advertising, not sold, not shared with anyone, and not used to send you email.
        </p>

        <h2>What it never collects</h2>
        <ul>
          <li>Your location. The app never asks for it. Where you are is worked out from your schedule alone.</li>
          <li>Anything for advertising. There are no ads, and nothing follows you to other sites.</li>
          <li>Anything about the driver. Only the bus&apos;s position is read from the apartment&apos;s tracker.</li>
        </ul>
        <p>The app sets one cookie, which keeps you signed in. It holds no personal details.</p>

        <h2>Visit counts</h2>
        <p>
          To see how many people use the app, it counts page views with Vercel Web Analytics. For each page opened, that records the page (for example &quot;/schedule&quot;, never anything after a &quot;?&quot;), the site that linked to it, and the rough country, browser and kind of device. It sets no cookie and keeps no account, name or email, so a visit can&apos;t be tied to you or to your classes. Vercel tells one visitor from another only within a day, using a scrambled code it throws away at midnight.
        </p>

        <h2>Who can see it</h2>
        <p>
          In the app, only you see your classes and settings. Other residents can&apos;t. The person who runs the app can read the database to keep it working and fix problems, and does not look at anyone&apos;s schedule for any other reason. Nothing is sold, shared or handed to SoL, ASU or anyone else.
        </p>

        <h2>Where it lives</h2>
        <p>
          The app is hosted by Vercel and the database by Supabase, both in the United States. Alerts travel through your phone maker&apos;s notification service (Apple, Google or Mozilla). They are encrypted on the way, so that service can deliver an alert but can&apos;t read it.
        </p>

        <h2>How long, and how to erase it</h2>
        <p>
          Your data stays until you remove it. You can change or delete any class at any time, and turn alerts off on any device. <strong>Settings, then Delete my account</strong> erases everything kept for you at once. There are no backups kept on purpose to bring it back.
        </p>

        <h2>The bus times</h2>
        <p>
          Times are estimates learned from how the bus has driven before. The bus can be early, late, on a break or off its route, and the tracker it relies on can stop without warning. Don&apos;t rely on the app for anything you can&apos;t afford to miss.
        </p>

        <h2>Questions</h2>
        <p>
          {contact ? (
            <>
              Write to <a href={`mailto:${contact}`}>{contact}</a>, or open an issue on the GitHub page above.
            </>
          ) : (
            <>Open an issue on the GitHub page above.</>
          )}{' '}
          The date at the top changes whenever this page does. The rules for using the app are on the <Link href="/terms">terms page</Link>.
        </p>
        <p>
          <Link href="/">Back to the bus</Link>
        </p>
      </article>
    </main>
  );
}
