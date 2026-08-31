'use client';

import { useState } from 'react';
import { Check, Loader2, ShieldAlert } from 'lucide-react';

import type { SettingStatus } from '@/core/domain/services/runtimeSettings';

/**
 * One row per setting, each saving on its own.
 *
 * Deliberately not a form with a single Save. These are unrelated values with
 * different blast radii, and batching them means an admin who came to change
 * a channel id can also, without noticing, apply a half-typed sending address
 * that stops every learner email.
 */
export function SettingsManager({ initialSettings }: { initialSettings: SettingStatus[] }) {
  const [settings, setSettings] = useState(initialSettings);

  return (
    <div className="flex flex-col gap-3">
      {settings.map((setting) => (
        <SettingRow
          key={setting.name}
          setting={setting}
          onSaved={(saved) =>
            setSettings((all) => all.map((s) => (s.name === saved.name ? saved : s)))
          }
        />
      ))}
    </div>
  );
}

function SettingRow({
  setting,
  onSaved,
}: {
  setting: SettingStatus;
  onSaved: (saved: SettingStatus) => void;
}) {
  const [value, setValue] = useState(setting.value ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // A secret's value never arrives here, so the box starts empty and an empty
  // box means "leave it alone" rather than "clear it". Clearing a key is not
  // something anybody wants to do by accident.
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

  // The sandbox redirect silently swallows every learner email while it is
  // set, so it says so rather than reading like any other field.
  const dangerous = setting.name === 'resendSandboxRecipient' && setting.configured;

  return (
    <section
      className={`rounded-xl border p-4 ${
        dangerous ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/60 bg-card/50'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-bold text-foreground">{setting.label}</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            setting.configured
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {setting.configured ? <Check className="h-3 w-3" /> : null}
          {setting.configured ? 'Set' : 'Not set'}
        </span>
      </div>

      <p className={`mt-1 text-xs leading-relaxed ${dangerous ? 'text-amber-300' : 'text-muted-foreground'}`}>
        {dangerous ? <ShieldAlert className="mr-1 inline h-3.5 w-3.5" /> : null}
        {setting.help}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type={setting.secret ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={setting.secret ? (setting.configured ? 'Paste a new value to replace it' : 'Not set') : ''}
          spellCheck={false}
          aria-label={setting.label}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="clay clay-press inline-flex items-center gap-1.5 rounded-lg bg-gradient-mars px-3 py-2 font-display text-xs font-bold text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </div>

      {message && (
        <p className={`mt-1.5 text-xs ${message.tone === 'ok' ? 'text-emerald-400' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
