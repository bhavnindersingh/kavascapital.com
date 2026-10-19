import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A one-of-N switch: trading mode, status filter, chart range.
 *
 * The app had four of these and no two agreed — a violet pill on Nightingale, a
 * grey filled box next to it, and a near-white fill on Least Action, all in the
 * same role. Selection is a STATE, not a category, so it wears `primary`
 * (near-white on this ground) and never a `cat-*` hue.
 *
 * Metrics are the button's: an 11px uppercase tracked label in a ruled box.
 */
export interface SegmentedOption<T> {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Stretch the segments to fill the row. */
  full?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function Segmented<T extends string | number | null>({
  options,
  value,
  onChange,
  full = false,
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-background p-0.5',
        full && 'flex w-full',
        className
      )}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            title={opt.title}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-eyebrow font-semibold uppercase tracking-widest transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              full && 'flex-1',
              // A pressed segment, NOT a call to action: the near-white
              // `primary` fill stays reserved for buttons that do something,
              // so a selected filter never outshouts the button beside it.
              selected
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
