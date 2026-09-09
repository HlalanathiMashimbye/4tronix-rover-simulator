import { ChallengesHub } from '@/components/challenges/ChallengesHub';

export default function ChallengesPage() {
  return (
    <main className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Mission <span className="text-gradient-mars">Challenges</span>
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Learn the platform, then build a real rover mission out of blocks.
        </p>
      </header>

      <div className="mx-auto w-full max-w-page flex-1 overflow-y-auto scroll-panel pb-5">
        <ChallengesHub />
      </div>
    </main>
  );
}
