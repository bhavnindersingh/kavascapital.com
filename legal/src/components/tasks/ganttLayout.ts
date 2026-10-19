import type { Task } from '@/types';

/**
 * Timeline geometry — pure functions, no React and no clock.
 *
 * Ported from the Nimai POS's `src/lib/ganttLayout.ts`. Two substitutions and
 * nothing else: task ids are numbers here, and "today" is the MARKET's day
 * (America/New_York) rather than IST.
 *
 * `today` is always a PARAMETER, never `new Date()` read inside. That is what
 * makes every function here deterministic, and it means the caller decides what
 * "today" means — the desk's day, not the browser's.
 *
 * Dates in and out are plain 'YYYY-MM-DD' strings. They are never turned into
 * local Date objects: `new Date('2026-08-01')` parses as UTC midnight and
 * renders as the 31st of July anywhere behind UTC — which is everywhere this
 * app is used. Everything below works in whole days via Date.UTC, so there is
 * no zone to get wrong.
 */

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Granularity = 'day' | 'week' | 'month';

export type TimelineColumn = {
  key: string;
  label: string;
  subLabel: string;
  startDay: number;
  days: number;
  isWeekend: boolean;
  isPeriodStart: boolean;
  offsetPct: number;
  widthPct: number;
};

export type Timeline = {
  granularity: Granularity;
  startDay: number | null;
  endDay: number | null;
  totalDays: number;
  columns: TimelineColumn[];
  todayDay?: number | null;
  todayOffsetPct: number | null;
};

/** 'YYYY-MM-DD' → integer day number (days since the epoch). null if unparseable. */
export const toDayNumber = (dateStr?: string | null): number | null => {
  const m = DATE_RE.exec(String(dateStr || '').slice(0, 10));
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(ms)) return null;
  // Reject a rolled-over date (2026-02-31 → 3 March) rather than silently
  // drawing a bar where nobody put one.
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return null;
  return Math.floor(ms / MS_PER_DAY);
};

/** Integer day number → 'YYYY-MM-DD'. */
export const fromDayNumber = (day: number): string =>
  new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/**
 * Today in the MARKET's zone as 'YYYY-MM-DD'. The one place a clock is read;
 * pass the result in.
 *
 * Not the browser's midnight and not UTC's: after 20:00 ET a UTC clock already
 * says tomorrow, so every deadline would turn red a few hours early for anybody
 * working an evening.
 */
export const marketToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export type Span = { startDay: number; endDay: number; milestone: boolean };

/**
 * A task's span, tolerating one-sided dates: a task with only a due date is a
 * milestone on that day, and so is one with only a start date. null when the
 * task has no dates at all — it belongs in the unscheduled tray, not on the
 * timeline.
 */
export const taskSpan = (task?: Partial<Task> | null): Span | null => {
  const start = toDayNumber(task?.start_date);
  const end = toDayNumber(task?.due_date);
  if (start === null && end === null) return null;
  if (start === null) return { startDay: end!, endDay: end!, milestone: true };
  if (end === null) return { startDay: start, endDay: start, milestone: true };
  // A stored row can't have end < start (a CHECK constraint refuses it), but a
  // live drag preview passes through here on its way to being clamped.
  if (end < start) return { startDay: end, endDay: start, milestone: false };
  return { startDay: start, endDay: end, milestone: false };
};

export const splitScheduled = (tasks: Task[] = []) => {
  const scheduled: Task[] = [];
  const unscheduled: Task[] = [];
  tasks.forEach((t) => (taskSpan(t) ? scheduled : unscheduled).push(t));
  return { scheduled, unscheduled };
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsOf = (day: number) => {
  const d = new Date(day * MS_PER_DAY);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
};

type RawColumn = Omit<TimelineColumn, 'offsetPct' | 'widthPct'>;

// Column ticks for the header. Bars are positioned as a percentage of the whole
// window, so granularity changes only the header and the readable width — it
// never moves a bar relative to the axis.
const buildColumns = (
  startDay: number,
  endDay: number,
  granularity: Granularity
): RawColumn[] => {
  const columns: RawColumn[] = [];

  if (granularity === 'day') {
    for (let day = startDay; day <= endDay; day += 1) {
      const p = partsOf(day);
      columns.push({
        key: fromDayNumber(day),
        label: String(p.date),
        subLabel: WEEKDAYS[p.weekday].slice(0, 1),
        startDay: day,
        days: 1,
        isWeekend: p.weekday === 0 || p.weekday === 6,
        isPeriodStart: p.date === 1,
      });
    }
    return columns;
  }

  if (granularity === 'week') {
    // Weeks start Monday, which keeps Sat/Sun adjacent.
    let cursor = startDay;
    const firstWeekday = partsOf(cursor).weekday;
    cursor -= (firstWeekday + 6) % 7; // Mon → 0, Sun → 6
    while (cursor <= endDay) {
      const p = partsOf(cursor);
      columns.push({
        key: fromDayNumber(cursor),
        label: `${p.date} ${MONTHS[p.month]}`,
        subLabel: 'wk',
        startDay: cursor,
        days: 7,
        isWeekend: false,
        isPeriodStart: p.date <= 7,
      });
      cursor += 7;
    }
    return columns;
  }

  let { year, month } = partsOf(startDay);
  for (;;) {
    const first = Math.floor(Date.UTC(year, month, 1) / MS_PER_DAY);
    const next = Math.floor(Date.UTC(year, month + 1, 1) / MS_PER_DAY);
    columns.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: MONTHS[month],
      subLabel: String(year).slice(2),
      startDay: first,
      days: next - first,
      isWeekend: false,
      isPeriodStart: true,
    });
    if (next > endDay) break;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return columns;
};

// How much breathing room to leave either side of the work, per granularity.
const PAD_DAYS: Record<Granularity, number> = { day: 2, week: 7, month: 15 };

/**
 * The timeline window every bar is measured against.
 *
 * The window always contains today, so the "today" marker is never off-screen
 * and an empty board still shows where now is. Columns may start before the
 * window (a week column starting the preceding Monday); that is intentional and
 * `startDay` remains the origin for positioning.
 */
export const buildTimeline = (
  tasks: Task[] = [],
  { today, granularity = 'day' }: { today: string; granularity?: Granularity }
): Timeline => {
  const gran: Granularity = (['day', 'week', 'month'] as const).includes(granularity)
    ? granularity
    : 'day';
  const todayDay = toDayNumber(today);

  const spans = tasks.map(taskSpan).filter(Boolean) as Span[];

  let startDay: number;
  let endDay: number;
  if (spans.length) {
    startDay = Math.min(...spans.map((s) => s.startDay));
    endDay = Math.max(...spans.map((s) => s.endDay));
  } else if (todayDay !== null) {
    startDay = todayDay;
    endDay = todayDay;
  } else {
    return {
      columns: [],
      startDay: null,
      endDay: null,
      totalDays: 0,
      todayOffsetPct: null,
      granularity: gran,
    };
  }

  const pad = PAD_DAYS[gran];
  startDay -= pad;
  endDay += pad;

  if (todayDay !== null) {
    startDay = Math.min(startDay, todayDay);
    endDay = Math.max(endDay, todayDay);
  }

  const columns = buildColumns(startDay, endDay, gran);
  // Columns can overhang the requested window on both sides (a week column
  // starting the previous Monday, a month column running past the end). The
  // drawable window is the union, so bars and header ticks share one origin.
  const windowStartDay = columns.length ? Math.min(startDay, columns[0].startDay) : startDay;
  const lastColumn = columns[columns.length - 1];
  const windowEndDay = columns.length
    ? Math.max(endDay, lastColumn.startDay + lastColumn.days - 1)
    : endDay;
  const totalDays = windowEndDay - windowStartDay + 1;

  return {
    granularity: gran,
    startDay: windowStartDay,
    endDay: windowEndDay,
    totalDays,
    columns: columns.map((c) => ({
      ...c,
      offsetPct: ((c.startDay - windowStartDay) / totalDays) * 100,
      widthPct: (c.days / totalDays) * 100,
    })),
    todayDay,
    todayOffsetPct:
      todayDay === null ? null : ((todayDay - windowStartDay + 0.5) / totalDays) * 100,
  };
};

export type Bar = {
  leftPct: number;
  widthPct: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  milestone: boolean;
  days: number;
};

/**
 * Where a task's bar sits in the window, as percentages. The span is inclusive
 * of both end days — a task due the day it starts is one day wide, not zero.
 */
export const barFor = (task: Partial<Task>, timeline: Timeline): Bar | null => {
  if (!timeline || !timeline.totalDays) return null;
  const span = taskSpan(task);
  if (!span) return null;

  const startDay = timeline.startDay!;
  const endDay = timeline.endDay!;
  const { totalDays } = timeline;
  const clippedStart = span.startDay < startDay;
  const clippedEnd = span.endDay > endDay;

  const from = Math.max(span.startDay, startDay);
  const to = Math.min(span.endDay, endDay);
  // Entirely outside the window — possible only if a caller hands over a task
  // that wasn't used to build the timeline.
  if (to < from) return null;

  return {
    leftPct: ((from - startDay) / totalDays) * 100,
    widthPct: ((to - from + 1) / totalDays) * 100,
    clippedStart,
    clippedEnd,
    milestone: span.milestone,
    days: span.endDay - span.startDay + 1,
  };
};

/** Overdue = past its due date and not done. Unscheduled tasks are never overdue. */
export const isOverdue = (task: Partial<Task> | null | undefined, today: string): boolean => {
  const due = toDayNumber(task?.due_date);
  const todayDay = toDayNumber(today);
  if (due === null || todayDay === null) return false;
  return task?.status !== 'done' && due < todayDay;
};

/** Days until due: 0 = due today, negative = overdue. null when undated. */
export const daysUntilDue = (
  task: Partial<Task> | null | undefined,
  today: string
): number | null => {
  const due = toDayNumber(task?.due_date);
  const todayDay = toDayNumber(today);
  if (due === null || todayDay === null) return null;
  return due - todayDay;
};

/** 'Mon 3 Aug' — for axis tooltips and the drawer. Zone-free by construction. */
export const formatSpanLabel = (dateStr?: string | null): string => {
  const day = toDayNumber(dateStr);
  if (day === null) return '';
  const p = partsOf(day);
  return `${WEEKDAYS[p.weekday]} ${p.date} ${MONTHS[p.month]}`;
};

// ════════════════════════════════════════════════════════════════════════════
// Rescheduling
// ════════════════════════════════════════════════════════════════════════════
//
// Dragging a bar edits dates, and the arithmetic for that belongs here with the
// rest of the day maths — NOT in the view. The view owns the pointer events and
// the one pixel measurement; everything below is whole days in, whole days out.

/**
 * How many days one pixel of the canvas is worth — the inverse of the scale the
 * bars are drawn at, so a drag of N px and the bar under the cursor agree.
 * Returns 0 when the canvas hasn't been measured; callers treat that as "not
 * draggable yet" rather than dividing by zero and flinging a bar to 1970.
 */
export const daysPerPixel = (timeline: Timeline, canvasWidth: number): number => {
  if (!timeline?.totalDays || !canvasWidth) return 0;
  return timeline.totalDays / canvasWidth;
};

/** Pixels dragged → whole days, rounded. A drag of less than half a day is none. */
export const daysDragged = (
  deltaPx: number,
  timeline: Timeline,
  canvasWidth: number
): number => {
  const perPx = daysPerPixel(timeline, canvasWidth);
  return perPx ? Math.round(deltaPx * perPx) : 0;
};

export type DragEdge = 'move' | 'start' | 'end';
export type Reschedule = { startDate: string | null; dueDate: string | null };

/**
 * The task's dates after a drag.
 *
 *   · move  — slide the whole span, keeping its length. A one-sided task (a
 *     milestone) slides its single date, so a task with only a due date stays a
 *     task with only a due date: a drag must never invent a date nobody set.
 *   · start — move the start only, clamped so it can't pass the due date.
 *   · end   — move the due date only, clamped so it can't precede the start.
 *
 * The clamps mirror the server's date-order check, so a drag stops dead at the
 * other end of the bar instead of travelling on and coming back as a rejection.
 * Returns null when the drag changes nothing — the caller skips the write.
 */
export const rescheduled = (
  task: Partial<Task>,
  deltaDays: number,
  edge: DragEdge = 'move'
): Reschedule | null => {
  const start = toDayNumber(task?.start_date);
  const end = toDayNumber(task?.due_date);
  if (start === null && end === null) return null;
  if (!deltaDays) return null;

  let nextStart = start;
  let nextEnd = end;

  if (edge === 'move') {
    if (start !== null) nextStart = start + deltaDays;
    if (end !== null) nextEnd = end + deltaDays;
  } else if (edge === 'start') {
    if (start === null) return null; // nothing to pull
    nextStart = start + deltaDays;
    if (end !== null && nextStart > end) nextStart = end;
  } else if (edge === 'end') {
    if (end === null) return null;
    nextEnd = end + deltaDays;
    if (start !== null && nextEnd < start) nextEnd = start;
  } else {
    return null;
  }

  if (nextStart === start && nextEnd === end) return null;

  return {
    startDate: nextStart === null ? null : fromDayNumber(nextStart),
    dueDate: nextEnd === null ? null : fromDayNumber(nextEnd),
  };
};

/**
 * A task wearing the dates a drag would give it — for the live preview, so the
 * bar tracks the pointer instead of jumping when the write lands. Never mutates.
 */
export const withDates = <T extends Partial<Task>>(task: T, dates: Reschedule | null): T =>
  dates ? { ...task, start_date: dates.startDate, due_date: dates.dueDate } : task;

// ════════════════════════════════════════════════════════════════════════════
// Dependency links
// ════════════════════════════════════════════════════════════════════════════

/**
 * The drawable edges among `rows`, as {from, to} where `from` must finish
 * first. A task's `blocked_by` names what it waits on, so the arrow points FROM
 * the prerequisite INTO the task. Edges whose other end isn't in `rows` are
 * dropped: an undated prerequisite lives in the tray and has no bar to draw
 * from, and half an arrow pointing into empty space is worse than none.
 */
export const dependencyEdges = (rows: Task[] = []) => {
  const index = new Map(rows.map((t, i) => [t.id, i]));
  const edges: { from: number; to: number }[] = [];
  rows.forEach((task) => {
    (task.blocked_by || []).forEach((fromId) => {
      if (index.has(fromId) && fromId !== task.id) edges.push({ from: fromId, to: task.id });
    });
  });
  return edges;
};

/**
 * The longest chain of dependent work, by total days — the run of tasks that
 * actually sets how soon the whole board can finish. Shortening anything off
 * this chain changes nothing; shortening something on it moves the end date.
 *
 * Defensive against a cycle even though the server refuses to store one (a
 * `visiting` guard, so a bad row can't hang the render).
 */
export const criticalChain = (rows: Task[] = []): Set<number> => {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const weightOf = (task: Task) => {
    const span = taskSpan(task);
    return span ? span.endDay - span.startDay + 1 : 0;
  };

  const best = new Map<number, { total: number; prev: number | null }>();
  const visiting = new Set<number>();

  const solve = (id: number): { total: number; prev: number | null } => {
    if (best.has(id)) return best.get(id)!;
    const task = byId.get(id);
    if (!task || visiting.has(id)) return { total: 0, prev: null };

    visiting.add(id);
    let winner: { total: number; prev: number | null } = { total: 0, prev: null };
    (task.blocked_by || []).forEach((fromId) => {
      if (!byId.has(fromId)) return;
      const upstream = solve(fromId);
      if (upstream.total > winner.total) winner = { total: upstream.total, prev: fromId };
    });
    visiting.delete(id);

    const result = { total: winner.total + weightOf(task), prev: winner.prev };
    best.set(id, result);
    return result;
  };

  rows.forEach((t) => solve(t.id));

  let tailId: number | null = null;
  let tailTotal = 0;
  rows.forEach((t) => {
    const r = best.get(t.id);
    if (r && r.total > tailTotal) {
      tailTotal = r.total;
      tailId = t.id;
    }
  });

  const chain = new Set<number>();
  let cursor: number | null = tailId;
  while (cursor !== null && !chain.has(cursor)) {
    chain.add(cursor);
    cursor = best.get(cursor)?.prev ?? null;
  }
  // A "chain" of one task is just the longest task — it carries no dependency
  // information, and highlighting one lone bar reads as a bug.
  return chain.size > 1 ? chain : new Set<number>();
};

// Length of the stub a link travels straight out of a bar before it turns.
const ELBOW = 11;

export type LinkPath = {
  id: string;
  from: number;
  to: number;
  d: string;
  tip: { x: number; y: number };
  critical: boolean;
};

/**
 * Orthogonal finish-to-start connectors, in PIXELS, ready for an SVG overlay.
 *
 * Pixels rather than percentages because an SVG path can't mix `%` for x with
 * `px` for y — so the caller measures the canvas once and passes `canvasWidth`
 * in. That keeps this function pure: hand it a width and the output is fully
 * determined.
 *
 * Two routes: the normal out-across-in, and — when the successor starts at or
 * before the predecessor ends — a detour through the whitespace between rows,
 * so an overlapping pair stays readable instead of hiding under the bars.
 */
export const linkPaths = (
  rows: Task[] = [],
  timeline: Timeline,
  {
    rowHeight,
    barHeight,
    canvasWidth,
    critical = new Set<number>(),
  }: { rowHeight: number; barHeight: number; canvasWidth: number; critical?: Set<number> }
): LinkPath[] => {
  if (!timeline?.totalDays || !canvasWidth || !rowHeight) return [];

  const index = new Map(rows.map((t, i) => [t.id, i]));
  const pxOf = (pct: number) => (pct / 100) * canvasWidth;
  const midY = (i: number) => i * rowHeight + rowHeight / 2;
  const gap = (rowHeight - barHeight) / 2; // whitespace above/below a bar

  return dependencyEdges(rows)
    .map(({ from, to }) => {
      const fi = index.get(from)!;
      const ti = index.get(to)!;
      const fromBar = barFor(rows[fi], timeline);
      const toBar = barFor(rows[ti], timeline);
      if (!fromBar || !toBar) return null;

      const x1 = pxOf(fromBar.leftPct + fromBar.widthPct);
      const y1 = midY(fi);
      const x2 = pxOf(toBar.leftPct);
      const y2 = midY(ti);

      const d =
        x2 >= x1 + ELBOW * 2
          ? `M ${x1} ${y1} L ${x1 + ELBOW} ${y1} L ${x1 + ELBOW} ${y2} L ${x2} ${y2}`
          : (() => {
              const gutterY =
                ti > fi ? y2 - barHeight / 2 - gap / 2 : y2 + barHeight / 2 + gap / 2;
              return (
                `M ${x1} ${y1} L ${x1 + ELBOW} ${y1} L ${x1 + ELBOW} ${gutterY} ` +
                `L ${x2 - ELBOW} ${gutterY} L ${x2 - ELBOW} ${y2} L ${x2} ${y2}`
              );
            })();

      return {
        id: `${from}->${to}`,
        from,
        to,
        d,
        tip: { x: x2, y: y2 },
        critical: critical.has(from) && critical.has(to),
      };
    })
    .filter(Boolean) as LinkPath[];
};
