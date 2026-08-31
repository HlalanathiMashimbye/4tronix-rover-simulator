import MissionVideoClient from './MissionVideoClient';
import { yardDirectory } from '@/infrastructure/config/yardDirectory';

export async function generateStaticParams() {
  // Required for output: export to work in Next.js when there are dynamic routes
  return [{ missionId: 'default' }];
}

export default async function MissionVideoPage({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  // Read here rather than in the client component: the yard list is the same
  // for everyone, so fetching it on the server costs one cached read instead
  // of a round trip from every learner's browser.
  const yards = await yardDirectory();
  return <MissionVideoClient missionId={missionId} yards={yards} />;
}
