'use client';

import { useState } from 'react';
import { Check, Loader2, MapPin, Pencil, Plus, RotateCcw, X } from 'lucide-react';

import { selectableYards, type Yard } from '@/core/domain/entities/Yard';

/**
 * Adding and retiring yards.
 *
 * There is no delete, and the UI says so where somebody would look for one.
 * Every mission ever run at a yard references its id, so removing one orphans
 * that history and a child's page silently loses the city it ran in.
 */
export function YardManager({ initialYards }: { initialYards: Yard[] }) {
  const [yards, setYards] = useState(initialYards);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [draft, setDraft] = useState({ id: '', name: '', area: '', city: '' });

  const active = selectableYards(yards);
  const retired = yards.filter((y) => !y.active);

  async function send(method: 'POST' | 'PATCH', body: unknown, busyKey: string) {
    setBusy(busyKey);
    setMessage(null);
    try {
      const resp = await fetch('/api/operator/yards', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Failed (HTTP ${resp.status})`);
      setYards(data.yards);
      return true;
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof Error ? error.message : 'Could not save' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const ok = await send('POST', draft, 'add');
    if (ok) {
      setDraft({ id: '', name: '', area: '', city: '' });
      setMessage({ tone: 'ok', text: 'Yard added. Operators can sign in there now.' });
    }
  }

  return (
    <section className="clay rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">Yards</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The places a rover lives. An operator picks one when they sign in, and every mission
        they run is attributed to it.
      </p>

      <ul className="mt-3.5 flex flex-col gap-2">
        {active.map((yard) => (
          <YardRow
            key={yard.id}
            yard={yard}
            busy={busy !== null}
            onSave={(details) => send('PATCH', { id: yard.id, ...details }, yard.id)}
            onRetire={() => send('PATCH', { id: yard.id, active: false }, yard.id)}
          />
        ))}
      </ul>

      {retired.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Retired
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not offered at sign-in. Still named on every mission that ran there, which is why
            a yard is retired rather than deleted.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {retired.map((yard) => (
              <li key={yard.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {yard.name} · <span className="font-mono">{yard.id}</span>
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => send('PATCH', { id: yard.id, active: true }, yard.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2 py-1 font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  Bring back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 border-t border-border/50 pt-3.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add a yard
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Id" hint="The rover's hostname. Lowercase, dashes." value={draft.id}
                 onChange={(v) => setDraft({ ...draft, id: v })} placeholder="durban" mono />
          <Field label="City" hint="What a learner reads." value={draft.city}
                 onChange={(v) => setDraft({ ...draft, city: v })} placeholder="Durban" />
          <Field label="Venue" value={draft.name}
                 onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Durban Science Centre" />
          <Field label="Suburb" value={draft.area}
                 onChange={(v) => setDraft({ ...draft, area: v })} placeholder="Umbilo" />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={busy !== null}
          className="clay-press mt-2.5 inline-flex h-11 items-center gap-1.5 rounded-lg bg-gradient-mars px-5 font-display text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add yard
        </button>
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.tone === 'ok' ? 'text-primary' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/**
 * One yard, readable until you ask to change it.
 *
 * The id is shown and never editable. It is the rover's hostname and every
 * mission ever run here carries it, so renaming it is a migration that has to
 * write formerIds and leave the old value resolving, not a text field.
 */
function YardRow({
  yard, busy, onSave, onRetire,
}: {
  yard: Yard;
  busy: boolean;
  onSave: (details: { name: string; area: string; city: string }) => Promise<boolean>;
  onRetire: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: yard.name, area: yard.area, city: yard.city });

  function cancel() {
    setDraft({ name: yard.name, area: yard.area, city: yard.city });
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">
            {yard.name}, {yard.area}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {yard.city} · <span className="font-mono">{yard.id}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={`Edit ${yard.name}`}
            disabled={busy}
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRetire}
            className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-50"
          >
            Retire
          </button>
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-primary/40 bg-background/40 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">
        Editing <span className="font-mono text-foreground">{yard.id}</span>. The id is the
        rover&apos;s hostname and every mission here carries it, so it cannot be changed.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Field label="Venue" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
        <Field label="Suburb" value={draft.area} onChange={(v) => setDraft({ ...draft, area: v })} />
        <Field label="City" value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { if (await onSave(draft)) setEditing(false); }}
          className="clay-press inline-flex items-center gap-1 rounded-lg bg-gradient-mars px-3 py-2 font-display text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          <Check className="h-3 w-3" />
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </li>
  );
}

function Field({
  label, hint, value, onChange, placeholder, mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70 ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
