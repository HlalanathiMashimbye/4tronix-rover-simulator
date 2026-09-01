'use client';

import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';

export default function LandingPage() {
  return (
    <main className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden px-4 sm:px-6">
      {/* Phone-only. The navbar's search is hidden below md, so without this a
          learner on a phone had no way to search or filter the feed at all. */}
      <div className="mx-auto w-full max-w-page pt-3">
        <MobileSearch />
      </div>

      <MissionFeed />
    </main>
  );
}
