import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';

import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';

export const metadata: Metadata = {
  title: 'Privacy · Mission Control',
  description: 'What Mission Control keeps about learners and operators, why, and how to have it removed.',
};

/**
 * What Mission Control keeps, why, and how to have it removed.
 *
 * Written from the code, not from a template, and for the people who use it:
 * learners, many of them children, and their parents and teachers. Every
 * sentence here is something the app does; when the app changes, this changes
 * with it. Google requires the page before the YouTube sign-in can leave
 * testing, and POPIA requires what it says whether or not anyone asked.
 *
 * Read per request: the contact is an admin setting, and a page rendered at
 * build time would name whoever was set when the image was built.
 */

const UPDATED = '22 October 2026';

/**
 * PostHog runs only when its key was set at build time (PostHogProvider), so
 * the analytics section follows the same switch: the page cannot say the site
 * is measured when it is not, or leave it out when it is.
 */
const ANALYTICS_ON = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  await connection();
  const contact = await readSetting('privacyContactEmail');

  return (
    <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-prose shrink-0 pt-4 pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          <span className="text-gradient-mars">Privacy</span>
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </header>

      <article className="mx-auto min-h-0 w-full max-w-prose flex-1 overflow-y-auto pb-10">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Mission Control is run by{' '}
          <a className="underline underline-offset-2 hover:text-foreground" href="https://sapient.rocks/about/" target="_blank" rel="noopener noreferrer">
            SAPIENT
          </a>{' '}
          for the Mars Yard at the Cape Town Science Centre. This page says what it keeps about you, why, who
          else handles it, and how to have it removed. You do not need an account to send a mission.
        </p>

        <Section title="What we keep">
          <p>
            <strong className="text-foreground">Your missions.</strong> The code you send, the name it is given,
            when it ran, how it went and the video of the rover running it. Missions are public: anyone can see them
            in the feed and open their page. So do not put your name, or anything else about you, in your code.
          </p>
          <p>
            <strong className="text-foreground">A random learner number.</strong> Your browser makes one up and keeps
            it, so that My Missions can show your missions. It is not your name or anything about you, and it is
            stored with your missions so they can be found.
          </p>
          <p>
            <strong className="text-foreground">Your email address, only if you give it.</strong> It is optional. We
            use it for two things: to email you when your mission has run, with a link to it, and to find your
            missions if you use another device. The address itself is kept where no web page can read it. Your
            missions only carry a scrambled form of it, not the address. Your browser also remembers it on this
            device, so you do not have to type it again.
          </p>
          <p>
            <strong className="text-foreground">Videos of the yard.</strong> A camera above the yard films the rover
            while your mission runs. It points at the yard floor, not at learners, but anyone standing in the yard
            can appear. The videos are put on YouTube and linked from the mission&apos;s page.
          </p>
          <p>
            <strong className="text-foreground">Operators.</strong> The people who run the yard sign in with an email
            address or a Google account. We keep that address, their name from Google if they use it, and what they
            are allowed to do.
          </p>
          {ANALYTICS_ON && (
            <p>
              <strong className="text-foreground">How the site is used.</strong> Which pages are opened, what is
              clicked, and errors, so we can find what is broken or confusing. Sometimes this includes a replay of
              the screen, with anything typed hidden. It is not linked to your name or your email.
            </p>
          )}
          <p>
            Your browser also keeps your code while you work on it, your light or dark choice, and whether you have
            seen the tour. That stays on your device.
          </p>
        </Section>

        <Section title="What we do not do">
          <p>No adverts, no selling or sharing your information for anyone&apos;s marketing, and no tracking you on other websites.</p>
        </Section>

        <Section title="Who else handles it">
          <p>
            Google Cloud runs the website (in Johannesburg) and the database (in Belgium), and Firebase handles
            operator sign-in. Resend sends the emails. YouTube holds the videos.
            {ANALYTICS_ON && ' PostHog, in the EU, records how the site is used.'} Each of them handles it only to do
            that job for us.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Missions and email addresses are kept until you ask us to remove them. After that, copies stay in our
            backups for up to 90 days, and then they are gone. Recordings on the yard&apos;s own computer are deleted
            from it after a few weeks.
          </p>
        </Section>

        <Section title="If you are a child">
          <p>
            Mission Control is made for learners, and many of them are children. You can send missions without
            giving an email address. If you are under 18, ask a parent, guardian or teacher before you add one.
          </p>
        </Section>

        <Section title="Seeing, changing or removing your information">
          <p>
            You can ask to see what we have about you, to correct it, to have it deleted, or to stop the emails.{' '}
            {contact ? (
              <>
                Email{' '}
                <a className="font-semibold text-foreground underline underline-offset-2" href={`mailto:${contact}`}>
                  {contact}
                </a>
                .
              </>
            ) : (
              <>Ask an operator at the Mars Yard, and they will pass it on.</>
            )}{' '}
            It helps to include the name of one of your missions, or the email address you gave.
          </p>
          <p>
            If you are not happy with how we handle it, you can complain to South Africa&apos;s{' '}
            <a className="underline underline-offset-2 hover:text-foreground" href="https://inforegulator.org.za/" target="_blank" rel="noopener noreferrer">
              Information Regulator
            </a>
            .
          </p>
        </Section>
      </article>
    </main>
  );
}
