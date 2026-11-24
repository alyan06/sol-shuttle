import type { Metadata } from 'next';
import Link from 'next/link';
import { TopBar } from '@/components/AppShell';
import { POLICY_UPDATED } from '@/lib/policy.ts';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="page">
      <TopBar />
      <header className="page-head">
        <h1>Privacy</h1>
        <p>What SoL Shuttle (solshuttle.app) keeps about you, why, and how to erase it. Last updated {POLICY_UPDATED}.</p>
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
            <strong>Today&apos;s taps.</strong> Things like &quot;skip this class&quot;, &quot;I&apos;m on the bus&quot; or &quot;going home now, 5 minutes from the stop&quot;, and which alerts have already gone out today. These are replaced the next day.
          </li>
        </ul>

        <h2>What your Google details are used for</h2>
        <p>
          Your name and email from Google are used for two things only: to know which account is yours when you sign in, and to show them back to you in Settings. They are not used for advertising, not sold, not shared with anyone, and not used to send you email.
        </p>

        <h2>Your location</h2>
        <p>
          The app never tracks where you are. There is one place it can use your location, and only when you tap <strong>Use my location</strong> under &quot;Going now&quot;: your phone asks you first, finds where you are once, and works out how many minutes you are from the bus stop. Only that number of minutes is sent to the app. Your position itself never leaves your phone and is not kept. You can always pick the minutes yourself instead.
        </p>

        <h2>What it never collects</h2>
        <ul>
          <li>Anything for advertising. There are no ads, and nothing follows you to other sites.</li>
          <li>Anything about the driver. Only the bus&apos;s position is read from the apartment&apos;s tracker.</li>
        </ul>
        <p>The app sets one cookie, which keeps you signed in. It holds no personal details.</p>

        <h2>Visit counts</h2>
        <p>
          To see how many people use the app, it counts page views with Vercel Web Analytics. For each page opened, that records the page (for example &quot;/schedule&quot;, never anything after a &quot;?&quot;), the site that linked to it, and the rough country, browser and kind of device. It sets no cookie and keeps no account, name or email, so a visit can&apos;t be tied to you or to your classes. Vercel tells one visitor from another only within a day, using a scrambled code it throws away at midnight.
        </p>

        <h2>Do Not Track</h2>
        <p>
          SoL Shuttle doesn&apos;t track you across websites or build a profile of you, so it treats every visitor the same whether or not their browser sends a Do Not Track signal.
        </p>

        <h2>What it records about the bus</h2>
        <p>
          To learn the route and when the bus comes, the app reads the shuttle&apos;s position (where it is, its heading and speed) from the apartment&apos;s public tracking link, and records when it reaches and leaves each stop, when it starts and finishes for the day, and when it stops for ten minutes or more. That is data about the vehicle, not about any person: the driver&apos;s name or anything else about them is never read. The day-by-day log is kept for 8 weeks, and the streets taken on a detour for a week. A few recorded trips, positions only, are part of the public code so the route can be rebuilt.
        </p>

        <h2>Who can see it</h2>
        <p>
          In the app, only you see your classes and settings. Other residents can&apos;t. The person who runs the app can read the database to keep it working and fix problems, and does not look at anyone&apos;s schedule for any other reason. Nothing is sold, shared or handed to SoL, ASU or anyone else.
        </p>

        <h2>Where it lives, and other services that see some data</h2>
        <ul>
          <li>The app is hosted by Vercel and the database by Supabase, both in the United States.</li>
          <li>Vercel and Supabase keep short-lived server logs, including IP addresses, to run and secure the service. The app itself counts requests from each IP address for one minute, in memory, to turn away floods and guessing; those counts are never written down.</li>
          <li>The map&apos;s streets load from OpenFreeMap, which sees your IP address when the map loads, like any website you visit.</li>
          <li>Signing in goes through Google, under Google&apos;s own privacy policy.</li>
          <li>Alerts travel through your phone maker&apos;s notification service (Apple, Google or Mozilla). They are encrypted on the way, so that service can deliver an alert but can&apos;t read it.</li>
        </ul>

        <h2>How long, and how to erase it</h2>
        <p>
          Your data stays until you remove it. You can change or delete any class at any time, and turn alerts off on any device. <strong>Settings, then Delete my account</strong> erases everything kept for you at once. The database is on a plan with no automatic backups, and the app keeps no backups of its own, so once it is erased it can&apos;t be brought back.
        </p>

        <h2>Children</h2>
        <p>SoL Shuttle isn&apos;t for children under 13, and doesn&apos;t knowingly keep anything about them. If you think a child has signed up, get in touch and their account will be deleted.</p>

        <h2>The bus times</h2>
        <p>
          Times are estimates learned from how the bus has driven before. The bus can be early, late, on a break or off its route, and the tracker it relies on can stop without warning. Don&apos;t rely on the app for anything you can&apos;t afford to miss.
        </p>

        <h2>Changes to this page</h2>
        <p>
          If a change affects what&apos;s collected or how it&apos;s used, everyone signed in sees a short notice about it on the home screen the next time they open the app, and the date at the top of this page changes. Smaller fixes to the wording only change the date.
        </p>

        <h2>Questions and requests</h2>
        <p>
          {contact ? (
            <>
              Write to <a href={`mailto:${contact}`}>{contact}</a>. Privacy and deletion requests get an answer within 7 days. You can also open an issue on the GitHub page above, but that is public.
            </>
          ) : (
            <>Open an issue on the GitHub page above.</>
          )}{' '}
          The rules for using the app are on the <Link href="/terms">terms page</Link>.
        </p>
        <p>
          <Link href="/">Back to the bus</Link>
        </p>
      </article>
    </main>
  );
}
