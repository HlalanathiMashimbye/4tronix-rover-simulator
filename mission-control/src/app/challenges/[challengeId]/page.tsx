import { notFound } from 'next/navigation';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import { isFirstChallengeOfLevel } from '@/core/domain/services/curriculumOutcomes';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

export default async function ChallengeWorkspacePage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  const challenge = CHALLENGES[challengeId as keyof typeof CHALLENGES];
  if (!challenge) notFound();

  const level = CHALLENGE_LEVELS.find((l) => l.id === challenge.levelId);
  const briefingLevel = level && isFirstChallengeOfLevel(level, challenge.id) ? level : undefined;

  return (
    <main className="relative px-3 py-2 md:h-[calc(100vh-64px)] md:overflow-hidden">
      <div className="mx-auto flex h-full max-w-page flex-col space-y-2">
        <header className="shrink-0">
          <h1 className="font-display text-xl font-bold text-foreground md:text-2xl">
            {challenge.title}
          </h1>
          <p className="text-xs text-muted-foreground md:text-sm">{challenge.summary}</p>
        </header>

        <ChallengeWorkspace challenge={challenge} briefingLevel={briefingLevel} />
      </div>
    </main>
  );
}
