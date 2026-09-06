import { MissionHistory } from '@/components/mission/MissionHistory';

export default function HistoryPage() {
  return (
    <main className="relative flex h-[calc(100dvh-var(--app-chrome))] flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          My <span className="text-gradient-mars">Missions</span>
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Every rover run you have sent, newest first.
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col pb-5">
        <MissionHistory />
      </div>
    </main>
  );
}
