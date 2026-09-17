import { notFound } from 'next/navigation';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { ChallengeWorkspace } from '@/components/challenges/ChallengeWorkspace';

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
          <h1 className="font-display text-xl font-bold text-foreground md:text-2xl">
            {challenge.title}
          </h1>
          <p className="text-xs text-muted-foreground md:text-sm">{challenge.summary}</p>
        </header>

        <ChallengeWorkspace challenge={challenge} />
      </div>
    </main>
  );
}
