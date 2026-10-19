import type React from 'react';
import type { Task, TaskPriority, TaskStatus } from '@/types';

/**
 * The words, colours and small date sums the task board reads by.
 *
 * Everything here is DISPLAY. No component compares a status to a raw key or
 * builds its own label — the backend's trail already writes labels rather than
 * keys for the same reason, and a second spelling of "quality_check" is exactly
 * how two screens come to disagree about what a column is called.
 */

/** Column order left to right. The board is read in this direction. */
export const STATUS_ORDER: TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'quality_check',
  'done',
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  // "On Hold" — a DECISION somebody made to park this. A task whose
  // prerequisite is unfinished is a different thing entirely and shows as a
  // "Waiting on …" chip, derived from the edges rather than from the column.
  blocked: 'On Hold',
  // Finished, not yet signed off. An OPEN status: overdue still bites here.
  quality_check: 'Quality Check',
  done: 'Done',
};

// ── THE ONE COLOUR RULE ─────────────────────────────────────────────────────
//
// Carried over from the POS board this is ported from, and it survives the move
// to a dark ground intact:
//
//     FILLED CRIMSON MEANS LATE, AND IT MEANS NOTHING ELSE.
//
// Crimson as an outline, a label or a button is ordinary chrome — the app uses
// `destructive` for delete controls all over. Crimson as a solid FILL appears on
// exactly three marks: the overdue chip, a card's late edge, and an overdue bar
// on the timeline. Nothing else on this screen may take a crimson fill.
//
// Two vocabularies carry the rest, and their SHAPES are load-bearing so the eye
// never has to ask which one it is reading:
//
//     a DOT is STATUS    — column head, timeline legend, list pill
//     a BAR is PRIORITY  — card edge, timeline gutter, list row
//
// Neither uses crimson. Status runs grey → blue → ochre → violet → green;
// priority is a VALUE ramp. A person is a hue from `personColour`, whose set
// also skips the crimson band for the same reason.

/**
 * Status and priority as CSS CUSTOM PROPERTIES, not Tailwind classes.
 *
 * The values live in `tasks.css` under `.tk`, because the same five hues are
 * needed as a dot, as a bar, as a timeline fill and as a legend swatch — and a
 * class map would have to repeat each one four times in four shapes. Naming the
 * variable lets the component say `background: var(--tk-progress)` wherever it
 * needs it and lets the stylesheet stay the one place the palette is decided.
 */
export const STATUS_VAR: Record<TaskStatus, string> = {
  todo: '--tk-todo',
  in_progress: '--tk-progress',
  blocked: '--tk-hold',
  quality_check: '--tk-qc',
  done: '--tk-done',
};

export const PRIORITY_VAR: Record<TaskPriority, string> = {
  low: '--tk-pri-low',
  medium: '--tk-pri-medium',
  high: '--tk-pri-high',
  urgent: '--tk-pri-urgent',
};

export const PRIORITY_ORDER: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * Eight board accents, not a colour wheel. The point is to tell three or four
 * boards apart down the rail at a glance, which a free picker does worse than a
 * small fixed set.
 *
 * These ARE the app's categorical ramp (--cat-1..7 in index.css) written as hex,
 * because a board colour is stored per row and rendered through an inline
 * style, where a CSS variable cannot reach. Keep them in step with that ramp.
 * The eighth is neutral. None sits in the red/amber or green bands: those carry
 * P&L and trigger state, and a board is neither.
 */
export const BOARD_COLOURS = [
  '#34b2a5',
  '#74c8e7',
  '#4165c8',
  '#afa0ee',
  '#af67c1',
  '#e495c7',
  '#a9947e',
  '#737373',
];

export const DEFAULT_BOARD_COLOUR = BOARD_COLOURS[0];

/**
 * Today as a plain day string, in the MARKET's zone.
 *
 * Not `new Date().toISOString()`: that is UTC, and after 20:00 ET it already
 * says tomorrow — so every due date would go amber a few hours early for
 * anybody working an evening. `en-CA` is used purely because it formats as
 * YYYY-MM-DD, which is the format the whole board speaks.
 */
export const marketToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Whole days from today to `day`. Negative is the past. */
export const daysUntil = (day: string | null): number | null => {
  if (!day) return null;
  const today = marketToday();
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
};

/**
 * Late — and DONE IS NEVER LATE, however long it sat.
 *
 * Every other status is open, Quality Check included: work finished but not
 * signed off is still work outstanding, and letting the reviewer's queue go
 * quiet is the exact failure that column exists to make visible.
 */
export const isOverdue = (task: Task): boolean => {
  if (task.status === 'done' || !task.due_date) return false;
  const d = daysUntil(task.due_date);
  return d !== null && d < 0;
};

/** A day string as a person writes it: "12 Oct", or "12 Oct 2027" off this year. */
export const formatDay = (day: string | null): string => {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const thisYear = +marketToday().slice(0, 4);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(y === thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
};

/** How a deadline reads on a card: "3 days left", "2 days late", "Today". */
export const dueLabel = (task: Task): string | null => {
  if (!task.due_date) return null;
  if (task.status === 'done') return formatDay(task.due_date);
  const d = daysUntil(task.due_date);
  if (d === null) return null;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d === -1) return '1 day late';
  if (d < 0) return `${-d} days late`;
  if (d <= 7) return `${d} days left`;
  return formatDay(task.due_date);
};

/** A timestamp as "just now" / "4h ago" / a date, for the trail and comments. */
export const relTime = (iso: string | null): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 5400) {
    const mins = Math.round(secs / 60);
    return mins < 60 ? `${mins}m ago` : '1h ago';
  }
  const hours = Math.round(secs / 3600);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Two initials for the owner chip. Falls back to a single glyph, never blank. */
export const initialsOf = (name: string | null | undefined): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/**
 * A stable colour per person, so the same face keeps the same chip everywhere
 * on the screen. Hashed from the name rather than the id, so an unassigned
 * placeholder and a real person never collide on a shared default.
 */
/**
 * A stable hue per person, so the same face keeps the same disc everywhere on
 * the screen. Hashed from the NAME rather than the id, so an unassigned
 * placeholder and a real person never collide on a shared default.
 *
 * NONE of these is in the crimson band, for the reason at the head of
 * `tasks.css`: on this screen a filled crimson mark means late.
 */
const PERSON_HUES = [211, 173, 258, 38, 330, 152, 199, 215];

/** Inline style for a person disc — background plus a legible foreground. */
export const personDisc = (name: string | null | undefined): React.CSSProperties => {
  if (!name) return {};
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const h = PERSON_HUES[hash % PERSON_HUES.length];
  return {
    background: `hsl(${h} 55% 22%)`,
    color: `hsl(${h} 70% 78%)`,
    borderColor: `hsl(${h} 50% 34%)`,
  };
};

export const maySignOff = (
  board: { owner_user_id: number | null } | null | undefined,
  userId: number | null | undefined
): boolean => {
  const owner = board?.owner_user_id ?? null;
  return !owner || owner === userId;
};
