'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * An overflow menu: one button, a list of actions underneath it.
 *
 * Exists for the phone, where a bar has room for one control and the operator
 * console has six secondary actions - two doors out, two admin pages, sign
 * out, and the way back to the learner site. Those are exactly the actions
 * that belong behind an overflow: none of them is what the operator came to
 * do, and every one of them was a labelled pill in a header that wrapped to
 * four lines.
 *
 * This is NOT hidden primary navigation. The research that argues against
 * hamburger menus (Nielsen Norman Group, 2016: hidden navigation is used about
 * half as often and takes longer to reach) is about hiding the places people
 * go. The queue's own destinations are a visible tab bar; this holds the
 * things they reach for once a shift.
 *
 * Closes on Escape, on a click outside, and after any item is chosen. Items
 * are whatever the caller passes - Links, buttons - given `role="menuitem"`
 * by the caller, because this component cannot know which element a menu item
 * needs to be.
 */
export function Menu({
  label,
  icon,
  children,
  align = 'end',
}: {
  /** The button's accessible name. */
  label: string;
  icon: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        // 44px: the smallest target Apple's guidelines call comfortable, and
        // this sits in the corner a thumb reaches last.
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-card/70 active:bg-card"
      >
        {icon}
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          // Closing on any click inside is what a menu does: the item has
          // acted (navigated, signed out) and the list has no reason to stay.
          onClick={() => setOpen(false)}
          className={`absolute top-full z-40 mt-1 min-w-56 overflow-hidden rounded-2xl border border-border/70 bg-popover p-1.5 shadow-card ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The shared shape of an item, so a Link and a button in the same menu line
 * up. Callers spread this onto whichever element they render.
 */
export const menuItemClass =
  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-card/70 active:bg-card disabled:opacity-50';
