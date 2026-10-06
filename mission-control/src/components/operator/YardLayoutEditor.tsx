'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Map as MapIcon, Plus, RotateCcw, X } from 'lucide-react';

import { layoutOf, selectableYards, type Yard, type YardLayout } from '@/core/domain/entities/Yard';
import { checkYardLayout } from '@/infrastructure/validation/yardLayout';
import { useTheme } from '@/contexts/ThemeContext';
import { useYardFloor } from '@/hooks/useYardFloor';
import { YARD, type YardZone, type ZoneLevel } from '@/lib/rover-physics';
import { computeLayout, drawSimFrame, DARK_SIM_PALETTE, LIGHT_SIM_PALETTE } from '@/lib/roverSimRender';

/**
 * A yard's layout, edited with the yard drawn beside it (AB#468): its size,
 * start, rocks and rising ground.
 *
 * It saves itself. Every change that checks out is sent a moment after the
 * typing stops, and the line under the form says so; a value that does not
 * check out marks its field, says what is wrong in words, and is not sent.
 * There is no Save button to forget, and nothing to ask "is this saved?".
 *
 * The rules are the API's own (checkYardLayout), so the form marks a field for
 * exactly the reason the server would refuse it.
 */
const SAVE_AFTER_MS = 700;

type Status = { tone: 'busy' | 'ok' | 'bad'; text: string } | null;
type Problem = { error: string; path: (string | number)[] } | null;

const LEVELS: { level: ZoneLevel; label: string; dot: string }[] = [
  { level: 'yellow', label: 'Yellow, gentle', dot: 'bg-yellow-400' },
  { level: 'orange', label: 'Orange, steep', dot: 'bg-orange-500' },
  { level: 'red', label: 'Red, the top', dot: 'bg-red-500' },
];

export function YardLayoutEditor({ initialYards }: { initialYards: Yard[] }) {
  const choices = selectableYards(initialYards);
  const [yardId, setYardId] = useState(choices[0]?.id ?? '');
  // Per yard: what the form holds, the last of it that checked out (what the
  // preview draws, so a half-typed number does not blank the drawing), and
  // whether the yard has a saved layout of its own yet.
  const [layouts, setLayouts] = useState<Record<string, { layout: YardLayout; good: YardLayout; configured: boolean }>>(() =>
    Object.fromEntries(initialYards.map((y) => [y.id, { layout: layoutOf(y), good: layoutOf(y), configured: Boolean(y.layout) }])),
  );
  const [status, setStatus] = useState<Status>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = layouts[yardId] ?? { layout: YARD, good: YARD, configured: false };
  const layout = current.layout;

  const save = useCallback(async (id: string, next: YardLayout) => {
    try {
      const response = await fetch('/api/operator/yards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, layout: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not save (HTTP ${response.status})`);
      setLayouts((all) => ({ ...all, [id]: { layout: all[id]?.layout ?? next, good: all[id]?.good ?? next, configured: true } }));
      setStatus({ tone: 'ok', text: 'Saved. Every simulator for this yard uses it within a minute.' });
    } catch (error) {
      setStatus({ tone: 'bad', text: error instanceof Error ? error.message : 'Could not save' });
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function change(next: YardLayout) {
    const checked = checkYardLayout(next);
    setLayouts((all) => ({
      ...all,
      [yardId]: {
        layout: next,
        good: 'layout' in checked ? checked.layout : (all[yardId]?.good ?? YARD),
        configured: all[yardId]?.configured ?? false,
      },
    }));
    if (timer.current) clearTimeout(timer.current);
    if ('error' in checked) {
      setProblem(checked);
      setStatus({ tone: 'bad', text: `Not saved: ${checked.error}` });
      return;
    }
    setProblem(null);
    setStatus({ tone: 'busy', text: 'Saving…' });
    const id = yardId;
    timer.current = setTimeout(() => save(id, checked.layout), SAVE_AFTER_MS);
  }

  const marked = (...path: (string | number)[]) =>
    problem !== null && path.length === problem.path.length && path.every((part, i) => part === problem.path[i]);

  const setRock = (index: number, field: keyof YardLayout['rocks'][number], value: string | number) =>
    change({ ...layout, rocks: layout.rocks.map((rock, i) => (i === index ? { ...rock, [field]: value } : rock)) });
  const setZone = (index: number, field: keyof YardZone, value: string | number) =>
    change({ ...layout, zones: (layout.zones ?? []).map((zone, i) => (i === index ? { ...zone, [field]: value } : zone)) });

  if (choices.length === 0) return null;

  return (
    <section className="clay rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 lg:col-span-2" aria-label="Yard layout">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold text-foreground">Yard layout</h2>
        </div>
        {choices.length > 1 && (
          <select
            aria-label="Yard"
            value={yardId}
            onChange={(e) => {
              setYardId(e.target.value);
              setProblem(null);
              setStatus(null);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            {choices.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        What the simulator draws and drives in for {choices.find((y) => y.id === yardId)?.name ?? 'this yard'}, in
        centimetres from the west wall (across) and the back, north wall (down). Rocks stop the rover. Zones are rising
        ground, yellow to red: they only warn the learner that the real run may differ, and never stop a mission being
        sent.
        {!current.configured && ' Not saved for this yard yet: this is the measured Cape Town layout, and the first change saves it as this yard\'s own.'}
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <YardPreview layout={current.good} yardId={yardId} />

        <div className="flex min-w-0 flex-col gap-4 text-xs">
          <Group title="Size, west to east and north to south">
            <Num label="Width" value={layout.widthCm} bad={marked('widthCm')} name="Yard"
                 onChange={(v) => change({ ...layout, widthCm: v })} />
            <Num label="Depth" value={layout.depthCm} bad={marked('depthCm')} name="Yard"
                 onChange={(v) => change({ ...layout, depthCm: v })} />
          </Group>

          <Group title="Start, and the way it faces: 0 north, 90 east, 180 south">
            <Num label="Across" value={layout.start.x} bad={marked('start', 'x')}
                 onChange={(v) => change({ ...layout, start: { ...layout.start, x: v } })} />
            <Num label="Down" value={layout.start.y} bad={marked('start', 'y')}
                 onChange={(v) => change({ ...layout, start: { ...layout.start, y: v } })} />
            <Num label="Facing" value={layout.start.facingDegrees} bad={marked('start', 'facingDegrees')}
                 onChange={(v) => change({ ...layout, start: { ...layout.start, facingDegrees: v } })} unit="°" />
          </Group>

          <Rows
            title="Rocks"
            note="Each one a point of interest the rover stops at, ringed and named on the map."
            addLabel="Add rock"
            onAdd={() =>
              change({
                ...layout,
                rocks: [
                  ...layout.rocks,
                  { name: `R${layout.rocks.length + 1}`, x: Math.round(layout.widthCm / 2), y: Math.round(layout.depthCm / 2), widthCm: 15, depthCm: 15 },
                ],
              })
            }
          >
            {layout.rocks.map((rock, i) => (
              <Row key={i} onRemove={() => change({ ...layout, rocks: layout.rocks.filter((_, j) => j !== i) })} what={`rock ${rock.name}`}>
                <label className="flex w-16 flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Name</span>
                  <input
                    aria-label={`Rock ${i + 1}, name`}
                    aria-invalid={marked('rocks', i, 'name') || undefined}
                    value={rock.name}
                    onChange={(e) => setRock(i, 'name', e.target.value)}
                    className={inputClass(marked('rocks', i, 'name'))}
                  />
                </label>
                <Num label="Across" value={rock.x} bad={marked('rocks', i, 'x')} onChange={(v) => setRock(i, 'x', v)} name={`Rock ${rock.name}`} />
                <Num label="Down" value={rock.y} bad={marked('rocks', i, 'y')} onChange={(v) => setRock(i, 'y', v)} name={`Rock ${rock.name}`} />
                <Num label="Width" value={rock.widthCm} bad={marked('rocks', i, 'widthCm')} onChange={(v) => setRock(i, 'widthCm', v)} name={`Rock ${rock.name}`} />
                <Num label="Depth" value={rock.depthCm} bad={marked('rocks', i, 'depthCm')} onChange={(v) => setRock(i, 'depthCm', v)} name={`Rock ${rock.name}`} />
              </Row>
            ))}
          </Rows>

          <Rows
            title="Zones"
            note="Rising ground, drawn by eye: an oval round a centre, as wide and as deep as its two radii."
            addLabel="Add zone"
            onAdd={() =>
              change({
                ...layout,
                zones: [
                  ...(layout.zones ?? []),
                  { level: 'yellow', x: Math.round(layout.widthCm / 2), y: Math.round(layout.depthCm / 2), rx: 20, ry: 20 },
                ],
              })
            }
          >
            {(layout.zones ?? []).map((zone, i) => (
              <Row key={i} onRemove={() => change({ ...layout, zones: (layout.zones ?? []).filter((_, j) => j !== i) })} what={`zone ${i + 1}`}>
                <label className="flex w-32 flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Colour</span>
                  <select
                    aria-label={`Zone ${i + 1}, colour`}
                    value={zone.level}
                    onChange={(e) => setZone(i, 'level', e.target.value as ZoneLevel)}
                    className={inputClass(false)}
                  >
                    {LEVELS.map(({ level, label }) => (
                      <option key={level} value={level}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Num label="Across" value={zone.x} bad={marked('zones', i, 'x')} onChange={(v) => setZone(i, 'x', v)} name={`Zone ${i + 1}`} />
                <Num label="Down" value={zone.y} bad={marked('zones', i, 'y')} onChange={(v) => setZone(i, 'y', v)} name={`Zone ${i + 1}`} />
                <Num label="Radius across" value={zone.rx} bad={marked('zones', i, 'rx')} onChange={(v) => setZone(i, 'rx', v)} name={`Zone ${i + 1}`} />
                <Num label="Radius down" value={zone.ry} bad={marked('zones', i, 'ry')} onChange={(v) => setZone(i, 'ry', v)} name={`Zone ${i + 1}`} />
              </Row>
            ))}
          </Rows>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
            <p
              role="status"
              className={`flex items-center gap-1.5 ${
                status?.tone === 'bad' ? 'text-destructive' : status?.tone === 'ok' ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {status?.tone === 'busy' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {status?.tone === 'ok' && <Check className="h-3.5 w-3.5" />}
              {status?.text ?? (current.configured ? 'Saved for this yard.' : 'The measured layout, not saved for this yard yet.')}
            </p>
            <button
              type="button"
              onClick={() => change(YARD)}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Back to the measured layout
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The yard as the simulator will draw it, redrawn as the form changes. Given only layouts that check out. */
function YardPreview({ layout, yardId }: { layout: YardLayout; yardId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const floor = useYardFloor(yardId);
  const shown = layout;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSimFrame(ctx, computeLayout(w, h, shown), [], 0, theme === 'light' ? LIGHT_SIM_PALETTE : DARK_SIM_PALETTE, floor);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [shown, theme, floor]);

  return (
    <div
      // Sticky on a laptop: the zone rows run long, and the point is to see
      // the yard change while typing in them.
      className="relative mx-auto w-full max-w-[28rem] self-start overflow-hidden rounded-2xl border border-border lg:sticky lg:top-4"
      style={{ aspectRatio: `${shown.widthCm} / ${shown.depthCm}` }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="The yard as the simulator draws it" role="img" />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Rows({ title, note, addLabel, onAdd, children }: {
  title: string; note: string; addLabel: string; onAdd: () => void; children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      <p className="text-muted-foreground">{note}</p>
      <ul className="flex flex-col gap-1.5">{children}</ul>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex w-fit items-center gap-1 rounded-lg border border-border/60 px-2 py-1 font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </fieldset>
  );
}

function Row({ children, onRemove, what }: { children: React.ReactNode; onRemove: () => void; what: string }) {
  return (
    <li className="flex flex-wrap items-end gap-2 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${what}`}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function Num({ label, value, onChange, bad, name, unit = 'cm' }: {
  label: string; value: number; onChange: (value: number) => void; bad: boolean; name?: string; unit?: string;
}) {
  return (
    <label className="flex w-24 flex-col gap-0.5">
      <span className="truncate text-[10px] text-muted-foreground" title={label}>
        {label} ({unit})
      </span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={name ? `${name}, ${label.toLowerCase()}` : label}
        aria-invalid={bad || undefined}
        // Empty while typing is NaN, which the rules refuse in words, rather
        // than a 0 that would quietly move a rock to the wall.
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        className={inputClass(bad)}
      />
    </label>
  );
}

function inputClass(bad: boolean): string {
  return `h-8 w-full rounded-md border bg-background px-1.5 tabular-nums text-foreground ${
    bad ? 'border-destructive ring-1 ring-destructive/40' : 'border-border'
  }`;
}
