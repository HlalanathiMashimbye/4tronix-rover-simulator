'use client';

import { useState } from 'react';
import { Check, Loader2, Mail, MonitorPlay } from 'lucide-react';

import type { SettingGroup, SettingStatus } from '@/core/domain/services/runtimeSettings';

/**
 * The settings an admin can change without a deploy.
 *
 * Grouped by what is being configured rather than listed flat: five identical
 * boxes in a column read as a dump of variables, which is the thing this page
 * exists to stop people having to think in.
 *
 * Each field still saves on its own. These are unrelated values with different
 * blast radii, and one Save means an admin who came to change a channel id can
 * also, without noticing, apply a half-typed sending address that stops every
 * learner email.
 */

const GROUPS: Record<SettingGroup, { title: string; blurb: string; Icon: typeof Mail }> = {
  email: {
    title: 'Learner email',
    blurb: 'Sends a child the link to their run. The address must be on a domain verified in Resend, or nothing goes out.',
    Icon: Mail,
  },
  youtube: {
    title: 'Run videos',
    blurb: 'Finds uploads by the MissionID in their description and attaches them to the mission on their own.',
    Icon: MonitorPlay,
  },
};

export function SettingsManager({ initialSettings }: { initialSettings: SettingStatus[] }) {
  const [settings, setSettings] = useState(initialSettings);

  const onSaved = (saved: SettingStatus) =>
    setSettings((all) => all.map((s) => (s.name === saved.name ? saved : s)));

  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(GROUPS) as SettingGroup[]).map((group) => {
        const rows = settings.filter((s) => s.group === group);
        if (rows.length === 0) return null;
        const { title, blurb, Icon } = GROUPS[group];

        return (
          <section key={group} className="clay rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-bold text-foreground">{title}</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{blurb}</p>

            <div className="mt-3.5 flex flex-col gap-3.5">
              {rows.map((setting) => (
                <SettingField key={setting.name} setting={setting} onSaved={onSaved} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SettingField({
  setting,
  onSaved,
}: {
  setting: SettingStatus;
  onSaved: (saved: SettingStatus) => void;
}) {
  const [value, setValue] = useState(setting.value ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // A secret's value never reaches the browser, so its box starts empty and an
  // empty box means "leave it alone" rather than "clear it". Nobody wants to
  // wipe an API key by tabbing past it.
  const emptyMeansUnchanged = setting.secret;

  async function save() {
    if (emptyMeansUnchanged && value.trim() === '') {
      setMessage({ tone: 'bad', text: 'Paste the new value first.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/operator/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: setting.name, value }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `Failed (HTTP ${resp.status})`);

      onSaved(body.setting);
      if (setting.secret) setValue('');
      setMessage({ tone: 'ok', text: 'Saved. Live within a minute.' });
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof Error ? error.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {setting.label}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${
            setting.configured ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          {setting.configured ? <Check className="h-3 w-3" /> : null}
          {setting.configured ? 'Set' : 'Not set'}
        </span>
      </span>

      <span className="flex gap-2">
        <input
          // Explicit, because the wrapping label also carries the status chip
          // and the help line: without this a screen reader announces the
          // field as "YouTube channel Set The channel run videos are..."
          aria-label={setting.label}
          type={setting.secret ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={setting.secret && setting.configured ? 'Paste a new value to replace it' : ''}
          spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="clay-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-mars px-5 font-display text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </span>

      <span
        className={`text-xs leading-relaxed ${
          message ? (message.tone === 'ok' ? 'text-primary' : 'text-destructive') : 'text-muted-foreground'
        }`}
      >
        {message ? message.text : setting.help}
      </span>
    </label>
  );
}
