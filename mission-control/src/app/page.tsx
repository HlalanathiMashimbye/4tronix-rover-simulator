'use client';

import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';
import { WelcomeCard } from '@/components/challenges/WelcomeCard';

export default function LandingPage() {
  return (
    <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
      {/* Phone-only. The navbar's search is hidden below md, so without this a
          learner on a phone had no way to search or filter the feed at all. */}
      <div className="mx-auto w-full max-w-page pt-3">
        <MobileSearch />
      </div>

      <MissionFeed />

      {/* On the home feed only, so a mission link from an email is never
          interrupted. See WelcomeCard for why this is not a page. */}
      <WelcomeCard />
    </main>
  );
}
