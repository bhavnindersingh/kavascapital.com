import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * TickFlash — broker-style price tick highlight.
 *
 * Wraps a rendered number and, whenever `value` changes, flashes the
 * background green (higher) or red (lower) and fades it out over 0.8 s
 * (`animate-tick-up` / `animate-tick-down` in tailwind.config.js). No flash
 * on first render, on an unchanged value, or when either side is missing.
 * Each instance tracks its own previous value, so every cell flashes
 * independently. Consecutive ticks in the same direction restart the fade.
 */
export const TickFlash: React.FC<{
  value: number | null | undefined;
  className?: string;
  children: React.ReactNode;
}> = ({ value, className, children }) => {
  const prev = useRef<number | null | undefined>(undefined);
  const seq = useRef(0);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === undefined || before == null || value == null || value === before) return;
    seq.current += 1;
    setFlash({ dir: value > before ? 'up' : 'down', n: seq.current });
    const t = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span
      key={flash?.n ?? 0}
      className={cn(
        'rounded-sm px-0.5 -mx-0.5',
        flash?.dir === 'up' && 'animate-tick-up',
        flash?.dir === 'down' && 'animate-tick-down',
        className,
      )}
    >
      {children}
    </span>
  );
};
