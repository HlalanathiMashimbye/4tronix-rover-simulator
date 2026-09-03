import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getOperatorSession } from '@/infrastructure/auth/dal';
import { SettingsManager } from '@/components/operator/SettingsManager';
import { YardManager } from '@/components/operator/YardManager';
import { adminYardRepository } from '@/infrastructure/container.server';
import {
  SETTINGS,
  describeSetting,
  type SettingName,
} from '@/core/domain/services/runtimeSettings';
import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';

/**
 * The configuration that used to live behind a terminal.
 *
 * Swapping a YouTube channel or a sending domain meant editing a tfvar,
 * running terraform, and waiting for a rollout. Everything on this page is
 * live within a minute of saving.
 *
 * A server component, like the team page, so an operator who is not an admin
 * is redirected before any of it renders rather than being sent the markup
 * and told not to look.
 */
export const metadata = { title: 'Platform settings' };

export default async function OperatorSettingsPage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect('/operator');
  }

  if (session.role !== 'admin') {
    redirect('/operator');
  }

  const names = Object.keys(SETTINGS) as SettingName[];
  const values = await Promise.all(names.map((name) => readSetting(name)));
  const settings = names.map((name, i) => describeSetting(name, values[i]));
  const yards = await adminYardRepository().findAll();

  return (
    <main className="relative flex min-h-[calc(100dvh-var(--app-chrome))] flex-col overflow-y-auto px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <Link
          href="/operator"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to console
        </Link>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Platform <span className="text-gradient-mars">settings</span>
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Two things this platform needs from the outside world: somewhere to send a
          child their run, and somewhere to find the video of it. Changes are live within
          a minute, with no deploy.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-page gap-3 pb-8 lg:grid-cols-2 lg:items-start">
        <YardManager initialYards={yards} />
        <SettingsManager initialSettings={settings} />
      </div>
    </main>
  );
}
