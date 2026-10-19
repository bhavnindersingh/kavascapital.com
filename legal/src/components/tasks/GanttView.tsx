import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import type { Task } from '@/types';
import { cn } from '@/lib/utils';
import {
  barFor,
  criticalChain,
  daysDragged,
  formatSpanLabel,
  isOverdue,
  linkPaths,
  rescheduled,
  splitScheduled,
  buildTimeline,
  withDates,
  type DragEdge,
  type Granularity,
  type Reschedule,
} from './ganttLayout';
import {
  PRIORITY_VAR,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_VAR,
  initialsOf,
  personDisc,
} from './taskUtils';
import './tasks.css';

/**
 * The timeline half of the board.
 *
 * All geometry comes from `ganttLayout` — this file only paints. Bars are
 * positioned by percentage over a header laid out from the same window, so the
 * two can't drift.
 *
 * Dependency arrows are the exception: an SVG path needs both coordinates in
 * the same unit, and a path can't mix `%` for x with `px` for y. So the canvas
 * width is MEASURED here and handed to `linkPaths`, which stays pure. That is
 * the only reason this component knows a pixel width at all.
 *
 * The longest dependency chain is drawn heavier than the rest. It is the run of
 * work that actually sets the finish date — shortening anything off it changes
 * nothing.
 *
 * Bars are DRAGGABLE: the body slides the whole span, the two edge grips pull
 * one date each. All the arithmetic is in `ganttLayout` — this file converts
 * pointer positions to a pixel delta and hands it over.
 *
 * The timeline window is NOT rebuilt mid-drag, deliberately. Recomputing it as
 * the dates move would rescale the axis under the cursor, so the bar would
 * chase a ruler that was itself moving. It rebuilds on commit instead.
 */

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// Row height, in px. Set here rather than in CSS because both the label gutter
// and the absolutely-positioned bars measure against it — one source, no drift.
const ROW_H = 42;
const BAR_H = 24;
const BAR_TOP = (ROW_H - BAR_H) / 2;

// A drag has to travel this far before it counts as a drag rather than a click.
const DRAG_SLOP_PX = 4;

type Drag = {
  taskId: number;
  edge: DragEdge;
  originX: number;
  deltaDays: number;
  moved: boolean;
};

export interface GanttViewProps {
  tasks: Task[];
  today: string;
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  /** task id → what it waits on, for the tooltip's "Waiting on …". */
  blockers: Map<number, Task[]>;
  onOpenTask: (t: Task) => void;
  onReschedule: (task: Task, dates: Reschedule) => void;
  /**
   * Name each row's board under its title — for the person timeline, where the
   * rows come from every project at once and a title alone has no context.
   *
   * As TEXT, never the board's colour dot: crimson in this gutter means late,
   * and a board somebody painted red would put alarm colour down a column of
   * work that is perfectly on time. Off on a board, where every row shares one
   * board and naming it per row is the heading written out thirty times.
   *
   * The two lines fit inside the existing 42px ROW_H and may not grow it: the
   * label gutter and the bars beside it are laid out from the same row height,
   * so moving one alone shears the view.
   */
  showBoard?: boolean;
}

export const GanttView: React.FC<GanttViewProps> = ({
  tasks,
  today,
  granularity,
  onGranularityChange,
  blockers,
  onOpenTask,
  onReschedule,
  showBoard = false,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The label gutter is a separate column, so it has to be told when the canvas
  // scrolls DOWN. Without this a board of thirty rows shows names against the
  // wrong bars the moment you scroll — the two halves are laid out from the
  // same ROW_H, and only their scroll positions can drift.
  const labelsRef = useRef<HTMLDivElement | null>(null);

  const { scheduled, unscheduled } = useMemo(() => splitScheduled(tasks), [tasks]);
  const timeline = useMemo(
    () => buildTimeline(scheduled, { today, granularity }),
    [scheduled, today, granularity]
  );

  // Bring today into view when the window or zoom changes — on a months-long
  // board the useful part is almost never the far left.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || timeline.todayOffsetPct === null) return;
    const x = (timeline.todayOffsetPct / 100) * el.scrollWidth;
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [timeline.todayOffsetPct, timeline.totalDays, granularity]);

  // Widen the canvas so day columns stay legible on a long project; the header
  // and the bars share this width, so they scroll as one.
  const minWidth =
    {
      day: Math.max(720, timeline.totalDays * 34),
      week: Math.max(720, timeline.columns.length * 64),
      month: Math.max(720, timeline.columns.length * 88),
    }[timeline.granularity] || 720;

  const rows = useMemo(
    () =>
      [...scheduled].sort((a, b) => {
        const ax = a.start_date || a.due_date || '';
        const bx = b.start_date || b.due_date || '';
        return ax.localeCompare(bx) || a.title.localeCompare(b.title);
      }),
    [scheduled]
  );

  // Measured canvas width, the one pixel value the connectors need. A callback
  // ref rather than useRef + effect: the node arrives and is measured in the
  // same commit, so the arrows draw on first paint instead of flicking in.
  const [canvasWidth, setCanvasWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const canvasRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    setCanvasWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    observerRef.current = new ResizeObserver(([entry]) => {
      setCanvasWidth((entry.target as HTMLElement).clientWidth);
    });
    observerRef.current.observe(node);
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // ── Dragging a bar ────────────────────────────────────────────────────────
  const [drag, setDrag] = useState<Drag | null>(null);
  // The same value in a ref, because the pointer handlers read it before React
  // has re-rendered — and because `click` needs to know what `pointerup` just
  // did, after the state behind it has already been cleared.
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);

  const putDrag = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const canDrag = Boolean(onReschedule) && canvasWidth > 0;

  const beginDrag = (e: React.PointerEvent, task: Task, edge: DragEdge) => {
    if (!canDrag) return;
    // Left button only; a right-click is a context menu, not a reschedule.
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* not every environment has capture */
    }
    putDrag({ taskId: task.id, edge, originX: e.clientX, deltaDays: 0, moved: false });
  };

  const moveDrag = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const deltaPx = e.clientX - current.originX;
    const deltaDays = daysDragged(deltaPx, timeline, canvasWidth);
    const moved = current.moved || Math.abs(deltaPx) > DRAG_SLOP_PX;
    if (deltaDays === current.deltaDays && moved === current.moved) return;
    putDrag({ ...current, deltaDays, moved });
  };

  const endDrag = (task: Task) => {
    const current = dragRef.current;
    putDrag(null);
    if (!current || current.taskId !== task.id) return;
    // A drag ends on the bar it started on, so the browser fires `click`
    // straight after `pointerup`. The state that would have told the click
    // handler to stand down has just been cleared, so the flag has to outlive
    // it — otherwise every reschedule is followed by the drawer opening on top.
    suppressClickRef.current = current.moved;
    const dates = rescheduled(task, current.deltaDays, current.edge);
    if (dates) onReschedule(task, dates);
  };

  // The row as the drag would leave it. Feeding this to barFor AND to linkPaths
  // is what makes the dependency arrows follow the bar instead of staying
  // pinned to where it used to be.
  const displayRows = useMemo(() => {
    if (!drag || !drag.deltaDays) return rows;
    return rows.map((t) =>
      t.id === drag.taskId ? withDates(t, rescheduled(t, drag.deltaDays, drag.edge)) : t
    );
  }, [rows, drag]);

  // `critical` stays keyed off the committed rows: recomputing the longest
  // chain on every pixel would make bars flick in and out of the highlight
  // mid-drag, which reads as a rendering fault rather than as information.
  const critical = useMemo(() => criticalChain(rows), [rows]);
  const links = useMemo(
    () =>
      linkPaths(displayRows, timeline, {
        rowHeight: ROW_H,
        barHeight: BAR_H,
        canvasWidth,
        critical,
      }),
    [displayRows, timeline, canvasWidth, critical]
  );

  return (
    <div className="tk flex h-full flex-col">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-md border border-border bg-card p-0.5"
          role="group"
          aria-label="Timeline zoom"
        >
          {GRANULARITIES.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => onGranularityChange(g.value)}
              aria-pressed={granularity === g.value}
              className={cn(
                'rounded px-2.5 py-1 text-eyebrow font-medium transition-colors',
                granularity === g.value
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Every bar is coloured by status, so the key carries the same colours
            as the board's column dots and the list's pills — one vocabulary
            across all three views. */}
        <div className="tk-gantt-legend flex flex-wrap items-center gap-x-3 gap-y-1">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: `var(${STATUS_VAR[s]})` }} />
              {STATUS_LABELS[s]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-0.5 bg-primary" /> Today
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-destructive" /> Overdue
          </span>
          {critical.size > 0 && (
            <span
              className="inline-flex items-center gap-1"
              title="The run of dependent work that sets the finish date"
            >
              <span className="h-0.5 w-4 bg-foreground" /> Longest chain
            </span>
          )}
        </div>
      </div>

      {!rows.length ? (
        // "Nothing here", not "nothing on this board" — a filter may be hiding
        // the dated work, and the view has no way to tell the two apart.
        <p className="flex h-full items-center justify-center px-6 text-center text-meta text-muted-foreground">
          Nothing here is scheduled yet. Give a task a start and a due date and it appears on the
          timeline.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          {/* Fixed label gutter — the names stay put while the timeline scrolls. */}
          <div className="w-52 shrink-0 overflow-hidden border-r border-border bg-card/40">
            <div className="h-11 border-b border-border" aria-hidden="true" />
            {/* Scrolled BY the canvas, never on its own — a scrollbar here
                would let the two columns be moved independently, which is the
                same drift this is preventing. */}
            <div ref={labelsRef} className="overflow-hidden">
              {rows.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  style={{ height: ROW_H }}
                  onClick={() => onOpenTask(task)}
                  title={
                    critical.has(task.id) ? `${task.title} — on the longest chain` : task.title
                  }
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-border/50 px-2 text-left transition-colors hover:bg-accent',
                    critical.has(task.id) && 'bg-foreground/[0.04]'
                  )}
                >
                  <span
                    className="tk-list-pri"
                    style={{ background: `var(${PRIORITY_VAR[task.priority]})` }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span
                      className={cn('tk-gantt-label block truncate', critical.has(task.id) && 'font-semibold')}
                    >
                      {task.title}
                    </span>
                    {showBoard && task.board && (
                      <span className="tk-gantt-label-board block truncate">{task.board.name}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            className="min-w-0 flex-1 overflow-auto"
            ref={scrollerRef}
            onScroll={(e) => {
              const el = labelsRef.current;
              if (el) el.scrollTop = (e.target as HTMLDivElement).scrollTop;
            }}
          >
            <div style={{ minWidth }} ref={canvasRef} className="relative">
              {/* Header ticks */}
              <div className="relative h-11 border-b border-border bg-card/40">
                {timeline.columns.map((c) => (
                  <div
                    key={c.key}
                    style={{ left: `${c.offsetPct}%`, width: `${c.widthPct}%` }}
                    className={cn(
                      'absolute top-0 flex h-full flex-col items-center justify-center border-l text-micro',
                      c.isPeriodStart ? 'border-border' : 'border-border/40',
                      c.isWeekend && 'bg-muted/40'
                    )}
                  >
                    <span className="tk-gantt-col font-medium tabular-nums text-foreground">{c.label}</span>
                    <span className="tk-gantt-col-sub">{c.subLabel}</span>
                  </div>
                ))}
              </div>

              <div className="relative" style={{ height: rows.length * ROW_H }}>
                {/* Grid lines, drawn from the same columns as the header. */}
                {timeline.columns.map((c) => (
                  <div
                    key={c.key}
                    style={{ left: `${c.offsetPct}%`, width: `${c.widthPct}%` }}
                    className={cn(
                      'absolute top-0 h-full border-l',
                      c.isPeriodStart ? 'border-border/60' : 'border-border/25',
                      c.isWeekend && 'bg-muted/25'
                    )}
                    aria-hidden="true"
                  />
                ))}

                {/* Connectors sit under the bars so a bar always wins a
                    collision — the arrow is context, the bar is the object. */}
                {links.length > 0 && (
                  <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={canvasWidth}
                    height={rows.length * ROW_H}
                    aria-hidden="true"
                    focusable="false"
                  >
                    {links.map((link) => (
                      <g
                        key={link.id}
                        className={
                          link.critical
                            ? 'stroke-foreground/70 fill-foreground/70'
                            : 'stroke-muted-foreground/40 fill-muted-foreground/40'
                        }
                        strokeWidth={link.critical ? 1.6 : 1}
                      >
                        <path d={link.d} fill="none" />
                        <polygon
                          stroke="none"
                          points={`${link.tip.x},${link.tip.y} ${link.tip.x - 6},${
                            link.tip.y - 3.5
                          } ${link.tip.x - 6},${link.tip.y + 3.5}`}
                        />
                      </g>
                    ))}
                  </svg>
                )}

                {timeline.todayOffsetPct !== null && (
                  <div
                    className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-primary/70"
                    style={{ left: `${timeline.todayOffsetPct}%` }}
                    title={`Today — ${formatSpanLabel(today)}`}
                    aria-hidden="true"
                  />
                )}

                {displayRows.map((task, i) => {
                  const bar = barFor(task, timeline);
                  if (!bar) return null;
                  const committed = rows[i];
                  const late = isOverdue(task, today);
                  const waiting = blockers?.get(task.id);
                  const dragging = drag?.taskId === task.id && drag.moved;
                  // Only a two-ended bar can be resized. Pulling an edge of a
                  // milestone would have to invent the date at the other end,
                  // and a drag is far too casual a gesture to create one.
                  const resizable = canDrag && !bar.milestone;

                  return (
                    <button
                      type="button"
                      key={task.id}
                      style={{
                        // FILLED CRIMSON MEANS LATE, and it means nothing else
                        // on this screen — status carries everything else.
                        background: late ? 'var(--tk-late)' : `var(${STATUS_VAR[task.status]})`,
                        left: `${bar.leftPct}%`,
                        width: `${bar.widthPct}%`,
                        top: i * ROW_H + BAR_TOP,
                        height: BAR_H,
                      }}
                      className={cn(
                        'group absolute z-20 flex items-center overflow-hidden rounded-[2px] px-1.5 text-micro font-medium text-white/95 shadow-sm transition-shadow',
                        bar.milestone && 'min-w-[10px] rounded-full',
                        critical.has(task.id) && 'ring-1 ring-foreground/60',
                        bar.clippedStart && 'rounded-l-none',
                        bar.clippedEnd && 'rounded-r-none',
                        canDrag && 'cursor-grab',
                        dragging && 'cursor-grabbing opacity-80 shadow-lg'
                      )}
                      onPointerDown={(e) => beginDrag(e, committed, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={() => endDrag(committed)}
                      onPointerCancel={() => putDrag(null)}
                      onClick={(e) => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          e.preventDefault();
                          return;
                        }
                        onOpenTask(committed);
                      }}
                      // Dates without a pointer at all. The drawer can edit them
                      // too, but a bar you can focus and not move is a dead end.
                      onKeyDown={(e) => {
                        if (!onReschedule || !e.altKey) return;
                        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                        if (!step) return;
                        e.preventDefault();
                        const edge: DragEdge = e.shiftKey ? 'end' : 'move';
                        const dates = rescheduled(committed, step, edge);
                        if (dates) onReschedule(committed, dates);
                      }}
                      title={[
                        task.title,
                        task.start_date ? `Start ${formatSpanLabel(task.start_date)}` : null,
                        task.due_date ? `Due ${formatSpanLabel(task.due_date)}` : null,
                        task.assignee_name,
                        waiting ? `Waiting on ${waiting.map((w) => w.title).join(', ')}` : null,
                        canDrag ? 'Drag to reschedule · Alt+← / Alt+→ to nudge' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    >
                      {task.progress > 0 && task.status !== 'done' && (
                        <span
                          className="absolute inset-y-0 left-0 bg-white/25"
                          style={{ width: `${task.progress}%` }}
                          aria-hidden="true"
                        />
                      )}
                      {/* The owner, or nothing. Falling back to the title would
                          print the task's name a few inches right of the gutter
                          that already shows it, while the one fact the gutter
                          can't show went missing on unassigned rows. */}
                      <span className="relative z-10 flex min-w-0 items-center gap-1">
                        {waiting && <Link2 className="h-2.5 w-2.5 shrink-0" />}
                        {task.assignee_name && (
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-white/40 text-micro font-bold"
                            style={personDisc(task.assignee_name)}
                            aria-hidden="true"
                          >
                            {initialsOf(task.assignee_name)}
                          </span>
                        )}
                        <span className="truncate">{task.assignee_name || ''}</span>
                      </span>

                      {/* Plain spans, not buttons: a button inside a button is
                          invalid, and these are pointer affordances only —
                          keyboard users get Alt+arrows on the bar itself. */}
                      {resizable && (
                        <>
                          <span
                            className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-white/40 group-hover:opacity-100"
                            aria-hidden="true"
                            onPointerDown={(e) => beginDrag(e, committed, 'start')}
                            onPointerMove={moveDrag}
                            onPointerUp={(e) => {
                              e.stopPropagation();
                              endDrag(committed);
                            }}
                            onPointerCancel={() => putDrag(null)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span
                            className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-white/40 group-hover:opacity-100"
                            aria-hidden="true"
                            onPointerDown={(e) => beginDrag(e, committed, 'end')}
                            onPointerMove={moveDrag}
                            onPointerUp={(e) => {
                              e.stopPropagation();
                              endDrag(committed);
                            }}
                            onPointerCancel={() => putDrag(null)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Undated tasks would otherwise vanish from this view entirely. */}
      {unscheduled.length > 0 && (
        <div className="mt-3 shrink-0 rounded-lg border border-border bg-card/40 p-3">
          <h4 className="tk-tray-title">
            Not scheduled{' '}
            <span className="tk-tray-count ml-1 rounded bg-muted px-1.5 py-0.5">
              {unscheduled.length}
            </span>
          </h4>
          <p className="tk-tray-hint mt-1">
            These have no dates, so they can't be placed on the timeline.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unscheduled.map((task) => (
              <button
                type="button"
                key={task.id}
                onClick={() => onOpenTask(task)}
                className="tk-tray-item inline-flex max-w-[220px] items-center gap-1.5 rounded-[3px] border border-border bg-card px-2 py-1 text-left hover:border-primary/40"
              >
                <span
                  className="tk-list-pri"
                  style={{ background: `var(${PRIORITY_VAR[task.priority]})` }}
                  aria-hidden="true"
                />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate">{task.title}</span>
                  {showBoard && task.board && (
                    <span className="block truncate text-micro text-muted-foreground">
                      {task.board.name}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GanttView;
