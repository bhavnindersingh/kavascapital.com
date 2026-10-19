import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The one page head.
 *
 * Every screen used to invent its own: a 2.3rem bold title on the dashboard, an
 * 18px bold one with a violet icon on Nightingale, an 18px one over a giant
 * mono price on the options chain, and a bordered strip on Least Action. Four
 * screens, four apps.
 *
 * The metrics are the Nimai board bar's (`.tk-boardbar-name` / `-desc` in
 * components/tasks/tasks.css), which is the reference implementation for this
 * app: 1.5rem at weight 500 — NOT bold; the size carries the emphasis, so
 * adding weight on top just makes it shout — over 13px muted, with a hairline
 * closing the block.
 *
 * The icon is always muted. A page head is chrome, and chrome is neutral here:
 * the `cat-*` ramp means "these things are different from each other", which a
 * lone page icon never does.
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  /** One line saying what the screen is for. */
  subtitle?: React.ReactNode;
  /** Optional lucide glyph, rendered muted at the title's cap height. */
  icon?: LucideIcon;
  /** Short facts that belong ON the title line — chips, live state, a count. */
  meta?: React.ReactNode;
  /** Controls, right-aligned. Buttons here are `<Button>`, not hand-rolled. */
  actions?: React.ReactNode;
  /** Drop the closing hairline, for a head sitting directly on its own panel. */
  bare?: boolean;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon: Icon,
  meta,
  actions,
  bare = false,
  className,
}) => (
  <header
    className={cn(
      'mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3',
      !bare && 'border-b border-border pb-4',
      className
    )}
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {Icon && <Icon size={18} className="shrink-0 text-muted-foreground" />}
        <h1 className="text-display font-medium leading-tight text-foreground">{title}</h1>
        {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {subtitle && <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

/**
 * A ruled label opening a band of content inside a page — the "RISK-ADJUSTED
 * RETURNS" strips on the dashboard. Nimai's label band: 10px, semibold,
 * uppercase, 0.16em, muted.
 */
export const SectionLabel: React.FC<{
  children: React.ReactNode;
  /** Secondary text after the label, in sentence case. */
  note?: React.ReactNode;
  className?: string;
}> = ({ children, note, className }) => (
  <h2
    className={cn(
      'mb-2.5 text-micro font-semibold uppercase tracking-widest text-muted-foreground',
      className
    )}
  >
    {children}
    {note && <span className="ml-2 font-normal normal-case tracking-normal">{note}</span>}
  </h2>
);
