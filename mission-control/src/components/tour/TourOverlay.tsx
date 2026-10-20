'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Rocket, X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useTour, TOUR_STEPS } from '@/contexts/TourContext';

const PADDING = 8;
const TOOLTIP_GAP = 12;
const TOOLTIP_MAX_W = 320;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function clampToViewport(rect: Rect): Rect {
  return {
    top: Math.max(0, rect.top),
    left: Math.max(0, rect.left),
    width: Math.min(rect.width, window.innerWidth - rect.left),
    height: Math.min(rect.height, window.innerHeight - rect.top),
  };
}

/**
 * Position the tooltip so it faces the spotlight from the placement side,
 * clamped to the viewport.
 */
function tooltipPosition(
  spotlight: Rect,
  placement: 'top' | 'bottom' | 'left' | 'right',
  tooltipH: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;

  switch (placement) {
    case 'bottom':
      top = spotlight.top + spotlight.height + TOOLTIP_GAP;
      left = spotlight.left + spotlight.width / 2 - TOOLTIP_MAX_W / 2;
      break;
    case 'top':
      top = spotlight.top - tooltipH - TOOLTIP_GAP;
      left = spotlight.left + spotlight.width / 2 - TOOLTIP_MAX_W / 2;
      break;
    case 'right':
      top = spotlight.top + spotlight.height / 2 - tooltipH / 2;
      left = spotlight.left + spotlight.width + TOOLTIP_GAP;
      break;
    case 'left':
      top = spotlight.top + spotlight.height / 2 - tooltipH / 2;
      left = spotlight.left - TOOLTIP_MAX_W - TOOLTIP_GAP;
      break;
  }

  // Clamp
  if (left + TOOLTIP_MAX_W > vw - 12) left = vw - TOOLTIP_MAX_W - 12;
  if (left < 12) left = 12;
  if (top + tooltipH > vh - 12) top = vh - tooltipH - 12;
  if (top < 12) top = 12;

  return { top, left };
}

export function TourOverlay() {
  const { active, step, currentStep, totalSteps, next, prev, skip } = useTour();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [extraRects, setExtraRects] = useState<Rect[]>([]);
  const [measuredStep, setMeasuredStep] = useState(step);
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipH, setTooltipH] = useState(160);
  const rafRef = useRef(0);

  // Measure the tooltip after render.
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipH(tooltipRef.current.offsetHeight);
    }
  }, [currentStep?.id]);

  // Track the target element's position (and any extra targets).
  const measure = useCallback(() => {
    if (!currentStep?.target) {
      setTargetRect(null);
      setExtraRects([]);
      setMeasuredStep(step);
      return;
    }
    const el = document.querySelector(`[data-tour-id="${currentStep.target}"]`);
    if (!el) {
      setTargetRect(null);
      setExtraRects([]);
      setMeasuredStep(step);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
    const extras: Rect[] = [];
    for (const id of currentStep.extraTargets ?? []) {
      const extra = document.querySelector(`[data-tour-id="${id}"]`);
      if (extra) {
        const er = extra.getBoundingClientRect();
        extras.push({
          top: er.top - PADDING,
          left: er.left - PADDING,
          width: er.width + PADDING * 2,
          height: er.height + PADDING * 2,
        });
      }
    }
    setExtraRects(extras);
    setMeasuredStep(step);
  }, [currentStep, step]);

  // Poll for the target (it may render after async loading).
  // Stops as soon as the element is found. If the target can't be found
  // after ~2s and the step has navigateTo, auto-advance so the tour
  // doesn't get stuck (e.g. mobile where the navbar button is hidden).
  useEffect(() => {
    if (!active || !currentStep?.target) return;
    let found = false;
    let attempts = 0;
    const maxAttempts = 120;
    const poll = () => {
      const el = document.querySelector(`[data-tour-id="${currentStep.target}"]`);
      if (el) {
        found = true;
        measure();
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        rafRef.current = requestAnimationFrame(poll);
      } else if (currentStep.navigateTo) {
        next();
      }
    };
    poll();
    return () => { if (!found) cancelAnimationFrame(rafRef.current); };
  }, [active, currentStep, measure, next]);

  // Re-measure on scroll and resize.
  useEffect(() => {
    if (!active || !currentStep?.target) return;
    const handler = () => measure();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [active, currentStep, measure]);

  // No auto-advance on target click — the learner always presses "Next".
  // For clickTargetOnNext steps, handleNext() programmatically clicks the
  // target (mode-switch tab, mission card, etc.) when Next is pressed.

  // Entrance / exit animation.
  useEffect(() => {
    if (active) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [active]);

  if (!active || !currentStep) return null;

  const isCenterModal = currentStep.target === null;
  const isWelcome = currentStep.id === 'welcome';
  const isFirstStep = step === 0;
  const isLastStep = step === totalSteps - 1;
  const progressStep = step;
  const progressTotal = totalSteps;

  // === Center modal (welcome, transition screens) ===
  if (isCenterModal) {
    return (
      <div
        className={`fixed inset-0 z-[10000] grid place-items-center px-4 py-8 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-modal-title"
      >
        <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
        <div
          className={`relative z-[10001] w-full max-w-sm rounded-2xl border border-border/70 bg-card p-7 text-center shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            visible ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
          }`}
        >
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
            <Rocket className="h-8 w-8 -rotate-45 text-primary" />
            <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-mars-glow animate-pulse" />
          </div>
          <h2
            id="tour-modal-title"
            className="mt-5 font-display text-xl font-bold text-foreground"
          >
            {currentStep.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {currentStep.body}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={next}
              autoFocus
              className="clay clay-press w-full rounded-xl bg-gradient-mars px-4 py-3 font-display text-sm font-bold text-primary-foreground"
            >
              {isWelcome ? 'Explore the Platform' : isLastStep ? 'Finish' : "Let's Go!"}
            </button>
            <button
              onClick={skip}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip Tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Spotlight step ===
  const spot = targetRect && measuredStep === step ? clampToViewport(targetRect) : null;
  const extras = measuredStep === step ? extraRects.map(clampToViewport) : [];
  const tp = spot ? tooltipPosition(spot, currentStep.placement as 'top' | 'bottom' | 'left' | 'right', tooltipH) : null;

  return (
    <>
      {/* Dark backdrop with a transparent cutout over the target.
          pointer-events: none so clicks reach the target naturally. */}
      {spot && (
        <div
          aria-hidden="true"
          className={`tour-spotlight ${currentStep.glow ? 'tour-glow' : ''}`}
          style={{
            position: 'fixed',
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            zIndex: 10000,
            borderRadius: 14,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Extra spotlights for secondary targets. */}
      {extras.map((r, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="tour-spotlight"
          style={{
            position: 'fixed',
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            zIndex: 10000,
            borderRadius: 14,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Tooltip card. Positioned near the spotlight. */}
      {spot && tp && (
        <div
          ref={tooltipRef}
          data-tour-tooltip=""
          role="dialog"
          aria-label={currentStep.title}
          className={`fixed z-[10001] w-[min(${TOOLTIP_MAX_W}px,calc(100vw-24px))] transition-[opacity,transform] duration-150 ${
            visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
          style={{
            top: tp.top,
            left: tp.left,
            maxWidth: TOOLTIP_MAX_W,
          }}
        >
          <div className="rounded-2xl border-[3px] border-buzz bg-card/95 p-4 shadow-xl backdrop-blur-sm">
            {/* Close / skip */}
            <button
              onClick={skip}
              className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Skip tour"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="pr-6 font-display text-sm font-bold text-foreground">
              {currentStep.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {currentStep.body}
            </p>

            {/* Footer: progress + back/next */}
            <div className="mt-4 flex items-center justify-between gap-2">
              {/* Progress dots */}
              <div className="flex items-center gap-1" aria-label={`Step ${progressStep + 1} of ${progressTotal}`}>
                {TOUR_STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full ${
                      i === step
                        ? 'w-4 bg-buzz'
                        : i < step
                          ? 'w-1.5 bg-buzz/40'
                          : 'w-1.5 bg-border'
                    }`}
                  />
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isFirstStep && (
                  <button
                    onClick={prev}
                    className="clay clay-press flex items-center gap-1 rounded-xl border border-border/60 bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}
                <button
                  onClick={next}
                  className="clay clay-press flex items-center gap-1 rounded-xl bg-gradient-buzz px-3 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  {isLastStep ? 'Finish' : 'Next'}
                  {!isLastStep && <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waiting state: target not found yet. */}
      {!spot && (
        <div className="fixed bottom-6 left-1/2 z-[10001] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-border/70 bg-card/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            <span className="text-xs font-semibold text-muted-foreground">Finding the next step...</span>
            <button
              onClick={skip}
              className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Skip tour
            </button>
          </div>
        </div>
      )}
    </>
  );
}
