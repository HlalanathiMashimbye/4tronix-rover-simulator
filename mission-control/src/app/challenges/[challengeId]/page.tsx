import { notFound } from 'next/navigation';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { ChallengeBriefingGate } from '@/components/challenges/ChallengeBriefing';

export default async function ChallengeWorkspacePage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  const challenge = CHALLENGES[challengeId as keyof typeof CHALLENGES];
  if (!challenge) notFound();

  return (
    <main className="relative px-3 py-2 md:h-[calc(100vh-64px)] md:overflow-hidden">
      <div className="mx-auto flex h-full max-w-page flex-col space-y-2">
        <header className="shrink-0">
          <p className="font-display text-sm font-bold uppercase tracking-wide text-kid-blue-text">
            Level {challenge.levelId} mission
          </p>
          <h1 className="font-display text-2xl font-bold text-foreground md:text-3xl">
            {challenge.title}
          </h1>
          <p className="text-sm text-kid-muted-text md:text-base">{challenge.summary}</p>
        </header>

        <ChallengeBriefingGate challenge={challenge} />
      </div>
    </main>
  );
}
