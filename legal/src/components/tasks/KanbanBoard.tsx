import React, { useCallback, useRef, useState } from 'react';
import { Check, Clock, Link2, Plus, User } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '@/types';
import { cn } from '@/lib/utils';
import { daysUntilDue, formatSpanLabel, isOverdue } from './ganttLayout';
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
 * The kanban half of the board: one column per status, cards moved between
 * them. TWO ways to move a card, both landing in the same `moveTask`:
 *
 *   · pointer — mouse and pen drag from anywhere on the card; touch drags from
 *     the grip on the card's left edge. One code path for all three, because
 *     they are one event stream.
 *   · keyboard — Ctrl/⌘ + arrows on a focused card. Left/right across columns,
 *     up/down within one.
 *
 * NOT HTML5 DRAG-AND-DROP, and that is the point. `draggable` +
 * dragstart/dragover/drop reads well and is a browser subsystem we cannot test,
 * cannot instrument and cannot make start on demand: it never fires on touch at
 * all, and on a desktop it silently declines whenever anything upstream — an
 * extension, a user stylesheet, a stray preventDefault on mousedown, a text
 * selection left on the page — has an opinion about the mousedown. When it
 * declines there is no event, no error and nothing to log; the card simply
 * doesn't lift. Pointer events have none of that, and the same handler serves
 * every input device.
 *
 * The cost is that we hit-test by hand instead of letting the browser do it —
 * `elementFromPoint` against the data attributes on the columns and cards,
 * which works under pointer capture because it is geometric rather than
 * event-based.
 *
 * Drop semantics: a card is inserted above or below whichever card the pointer
 * is over, whichever half of it the pointer is in; over a column's empty space
 * it appends. The whole destination column renumbers on drop, so `sort_order`
 * stays dense and a later insert never has to renumber the world.
 */

/** How far the pointer must travel before this is a drag rather than a click. */
const DRAG_SLOP_PX = 4;

/** How close to the viewport edge a drag gets before the page scrolls, and how fast. */
const AUTOSCROLL_EDGE_PX = 72;
const AUTOSCROLL_STEP_PX = 12;

/**
 * Priority is stated in WORDS, not only in a colour a reader has to decode —
 * and only when it is above the norm. Medium and low carry no chip at all:
 * most work is medium, and labelling every card with its rank would make the
 * two that actually matter disappear into the pattern.
 */
const URGENCY: Partial<Record<TaskPriority, string>> = { urgent: 'Urgent', high: 'High' };

/**
 * How much of the Done log shows before it folds. Done never empties itself —
 * finished work is the board's history — so past this many the tail collapses
 * behind "…N finished earlier" instead of growing the column forever.
 */
const DONE_VISIBLE = 8;

/**
 * Done orders itself by WHEN, newest first — it is a log, not a list anyone
 * curates. `completed_at` is stamped server-side on the way in; a card that has
 * just landed optimistically hasn't got one yet, so absent sorts FIRST — it is
 * by definition the newest thing here.
 */
const doneKey = (t: Task) => t.completed_at || '9999';
const byFinishedDesc = (a: Task, b: Task) => doneKey(b).localeCompare(doneKey(a));

export type ReorderUpdate = { id: number; status?: TaskStatus; sort_order: number };

/**
 * The due-date chip's wording. Relative for the days that matter, absolute once
 * it is far enough out that "in 23 days" stops meaning anything.
 *
 * A FINISHED CARD CARRIES NO DATE AT ALL. A deadline is a claim about work
 * still to be done — the same argument that takes the "Urgent" chip off a done
 * card — and the Done column has already answered it. Returning null closes the
 * chip row, both chip slots and the aria-label at once, so a bare done card
 * opens no empty strip.
 *
 * Only unfinished work reaches the ladder below, which is why a past date is
 * unconditionally late here: `isOverdue`'s one other condition is the status
 * this function has already refused.
 */
const dueLabel = (
  task: Task,
  today: string
): { text: string; tone: 'late' | 'soon' | 'ok' } | null => {
  if (task.status === 'done') return null;
  const days = daysUntilDue(task, today);
  if (days === null) return null;
  if (days < -1) return { text: `${Math.abs(days)}d overdue`, tone: 'late' };
  if (days === -1) return { text: 'Yesterday', tone: 'late' };
  if (days === 0) return { text: 'Today', tone: 'soon' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days <= 7) return { text: `In ${days}d`, tone: 'ok' };
  return { text: formatSpanLabel(task.due_date), tone: 'ok' };
};

/**
 * What the card says about an unfinished prerequisite. NAMING IT is the whole
 * value: "Blocked" tells you to go looking, "Waiting on Order the settings"
 * tells you what to go and do. Two or more won't fit on a card, so those get a
 * count and the full list stays in the drawer.
 */
const waitingLabel = (waiting?: Task[]) => {
  if (!waiting || !waiting.length) return null;
  return waiting.length === 1
    ? `Waiting on ${waiting[0].title}`
    : `Waiting on ${waiting.length} tasks`;
};

const TaskCard: React.FC<{
  task: Task;
  today: string;
  waiting?: Task[];
  isDragging: boolean;
  onOpen: (t: Task) => void;
  onCardDown: (e: React.PointerEvent, t: Task) => void;
  onGripDown: (e: React.PointerEvent, t: Task) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragUp: () => void;
  onDragCancel: () => void;
  onDragClick: () => boolean;
  onKeyMove: (t: Task, key: string) => boolean;
}> = ({
  task,
  today,
  waiting,
  isDragging,
  onOpen,
  onCardDown,
  onGripDown,
  onDragMove,
  onDragUp,
  onDragCancel,
  onDragClick,
  onKeyMove,
}) => {
  const due = dueLabel(task, today);
  const late = isOverdue(task, today);
  // "Urgent" is a claim about work still to be done. On a finished card it is
  // the same argument `dueLabel` makes about the deadline: the rank was how the
  // task was to be TREATED, and the Done column has already answered that. The
  // priority rail stays — it is the card's rank, readable down the column, and
  // it is what makes two done cards comparable.
  const urgency = task.status === 'done' ? null : URGENCY[task.priority];
  const waitingText = waitingLabel(waiting);
  const subtasks = task.subtasks ?? [];
  const subtasksDone = subtasks.filter((s) => s.is_done).length;
  // A done row sits at 100 (the completion patch forces it), so a bare
  // `progress > 0` would open an empty chip strip on every finished card.
  const showProgress = task.progress > 0 && task.status !== 'done';

  // Built once and placed in one of two slots — first when it is a crimson
  // overdue tab, last when it is an ordinary date. Two copies of this JSX would
  // be two places to forget the icon.
  const dueChip = due && (
    <span className={cn('tk-chip', `tk-chip-${due.tone}`)}>
      <Clock className="h-3 w-3 shrink-0" /> {due.text}
    </span>
  );

  return (
    <article
      // Mouse and pen drag from anywhere on the card; touch is turned away here
      // and served by the grip instead, so a finger dragged across a card still
      // scrolls the page.
      onPointerDown={(e) => onCardDown(e, task)}
      onPointerMove={onDragMove}
      onPointerUp={onDragUp}
      onPointerCancel={onDragCancel}
      // A drag ends on the card it started on, so the browser fires `click`
      // straight after `pointerup`. Without this, every completed move opens
      // the drawer on top of itself.
      onClick={() => {
        if (!onDragClick()) onOpen(task);
      }}
      onKeyDown={(e) => {
        // Ctrl/⌘ + arrow moves the card; a bare Enter or Space still opens it.
        if (e.ctrlKey || e.metaKey) {
          if (onKeyMove(task, e.key)) e.preventDefault();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(task);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}${due ? `, due ${due.text}` : ''}`}
      className={cn('tk-card', isDragging && 'tk-card-dragging', late && 'tk-card-late')}
    >
      {/* PRIORITY, at full strength, on every card — including the two that
          carry no chip. This is the strongest scanning position on a kanban
          card, and a rank is the one thing worth reading down a column without
          reading the cards.

          It doubles as the touch drag grip; widening its hit area on a
          touchscreen costs nothing on a desktop, where the whole card is
          already the handle. */}
      <div
        onPointerDown={(e) => onGripDown(e, task)}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragCancel}
        aria-hidden="true"
        className="tk-card-rail"
        style={{ background: `var(${PRIORITY_VAR[task.priority]})` }}
      />

      <div className="tk-card-body">
        <p className="tk-card-title">{task.title}</p>

        {(due || waitingText || showProgress || urgency || subtasks.length > 0) && (
          <div className="tk-card-chips">
            {/* LATE LEADS. The chips are ordered by SEVERITY, not by category:
                if a task is overdue that is the first thing about it, ahead of
                how important it was meant to be. A punctual card puts its due
                date last instead, where a date belongs. */}
            {due && due.tone === 'late' && dueChip}

            {urgency && (
              <span className={cn('tk-chip', `tk-chip-pri-${task.priority}`)}>{urgency}</span>
            )}

            {/* Ink, NOT crimson. Crimson is spent on overdue, and a card that
                was both waiting and late wore two identical red chips saying
                different things. Waiting is a state of the plan; late is a
                problem. */}
            {waitingText && (
              <span className="tk-chip tk-chip-blocked" title={waiting!.map((w) => w.title).join(' · ')}>
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="tk-chip-text">{waitingText}</span>
              </span>
            )}

            {due && due.tone !== 'late' && dueChip}

            {/* The checklist count, neutral like the date — steps being worked
                through is the plan working, not a warning. */}
            {subtasks.length > 0 && (
              <span
                className="tk-chip"
                title={
                  subtasks
                    .filter((s) => !s.is_done)
                    .map((s) => s.title)
                    .join(' · ') || 'All steps done'
                }
              >
                <Check className="h-3 w-3 shrink-0" /> {subtasksDone}/{subtasks.length}
              </span>
            )}

            {showProgress && <span className="tk-chip">{task.progress}%</span>}
          </div>
        )}

        {showProgress && (
          <div className="tk-card-progress" aria-hidden="true">
            <span style={{ width: `${task.progress}%` }} />
          </div>
        )}
      </div>

      {/* The owner, and the only colour on the card that isn't crimson-for-late.
          A disc with initials on it: you read the initials, and the hue is what
          lets you find the same person again two columns over without reading
          anything. */}
      {task.assignee_name ? (
        <span className="tk-avatar" style={personDisc(task.assignee_name)} title={task.assignee_name}>
          {initialsOf(task.assignee_name)}
        </span>
      ) : (
        <span className="tk-avatar tk-avatar-empty" title="Unassigned">
          <User className="h-3 w-3" />
        </span>
      )}
    </article>
  );
};

export interface KanbanBoardProps {
  /** What is VISIBLE — filters applied. */
  tasks: Task[];
  /**
   * The WHOLE board. Rendering uses `tasks`; renumbering on drop must use this.
   * Renumbering the visible subset 0..n-1 would collide with the sort_order of
   * every card a filter is hiding, and clearing the filter would reveal a
   * scrambled column.
   */
  allTasks: Task[];
  today: string;
  blockers: Map<number, Task[]>;
  onOpenTask: (t: Task) => void;
  onQuickAdd: (input: { title: string; status: TaskStatus }) => void;
  onReorder: (updates: ReorderUpdate[]) => void;
  /**
   * May this person move work into Done on this board? HANDED down, never
   * derived here. True on a board with no owner, which is every board that
   * predates the reviewer.
   */
  canSignOff: boolean;
  /** The BOARD OWNER's name, for when the column refuses — a next step, not a wall. */
  signOffBy: string;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  allTasks,
  today,
  blockers,
  onOpenTask,
  onQuickAdd,
  onReorder,
  canSignOff,
  signOffBy,
}) => {
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    status: TaskStatus;
    index: number | null;
  } | null>(null);
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [showAllDone, setShowAllDone] = useState(false);

  // Both of these are read from inside pointermove, which React batches — by
  // the time the pointer lifts, the state behind them may be a frame stale.
  // The refs are what pointerup actually acts on.
  const dragRef = useRef<{
    taskId: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const dropTargetRef = useRef<{ status: TaskStatus; index: number | null } | null>(null);
  // A finished drag leaves a synthesised click behind it. This outlives the
  // state that would otherwise have told the click to stand down.
  const suppressClickRef = useRef(false);

  const putDropTarget = useCallback(
    (next: { status: TaskStatus; index: number | null } | null) => {
      dropTargetRef.current = next;
      setDropTarget(next);
    },
    []
  );

  const columns = STATUS_ORDER.map((value) => ({
    value,
    label: STATUS_LABELS[value],
    tasks:
      value === 'done'
        ? tasks.filter((t) => t.status === 'done').sort(byFinishedDesc)
        : tasks.filter((t) => t.status === value),
  }));

  // ── The one move ──────────────────────────────────────────────────────────
  // Pointer drop and keyboard move both end here, so the two cannot drift apart
  // on the thing that is genuinely subtle: renumbering a column that a filter
  // is only showing part of.
  //
  // `index` is a position among the VISIBLE cards of the destination column
  // WITHOUT the card being moved, or null to append.
  const moveTask = useCallback(
    (taskId: number, status: TaskStatus, index: number | null) => {
      const board = allTasks.length ? allTasks : tasks;
      const moved = board.find((t) => t.id === taskId);
      if (!moved) return false;

      // ── Done is a log, not a list ───────────────────────────────────────
      // Finished work orders itself by completed_at, so a drop into Done writes
      // ONE row — the mover's status — instead of renumbering a column that
      // only ever grows. And a drag WITHIN Done is a no-op: the log's order is
      // when things finished, which is not the user's to rearrange.
      if (status === 'done') {
        if (moved.status === 'done') return false;
        onReorder([{ id: moved.id, status: 'done', sort_order: moved.sort_order || 0 }]);
        return true;
      }

      // Translate the visible position into a position in the full column by
      // anchoring on the card being dropped above, so hidden cards keep their
      // place relative to their visible neighbours.
      const visibleColumn = tasks.filter((t) => t.status === status && t.id !== moved.id);
      const fullColumn = board.filter((t) => t.status === status && t.id !== moved.id);

      const anchor =
        index === null || index >= visibleColumn.length ? null : visibleColumn[index];
      const anchorAt = anchor ? fullColumn.findIndex((t) => t.id === anchor.id) : -1;
      const at = anchorAt === -1 ? fullColumn.length : anchorAt;
      fullColumn.splice(at, 0, { ...moved, status });

      // Renumber the whole destination column. Only rows whose status or
      // position actually changed are sent.
      const updates: ReorderUpdate[] = fullColumn
        .map((t, i) => ({ id: t.id, status, sort_order: i }))
        .filter((u, i) => {
          const before = board.find((t) => t.id === u.id);
          return !before || before.status !== status || before.sort_order !== i;
        });

      if (!updates.length) return false;
      onReorder(updates);
      return true;
    },
    [allTasks, tasks, onReorder]
  );

  // `data-tk-index` counts the cards as RENDERED, which includes the one being
  // dragged. `moveTask` counts the destination column without it. Inside a
  // card's own column those two disagree by one for every slot below it, and
  // the difference is a drag that lands one place too high and reads as "it
  // snapped back". The keyboard path already speaks the second dialect, so this
  // translation belongs to the pointer path alone.
  const toInsertAt = useCallback(
    (taskId: number, status: TaskStatus, index: number | null) => {
      if (index === null) return null;
      const column = tasks.filter((t) => t.status === status);
      const selfAt = column.findIndex((t) => t.id === taskId);
      return selfAt !== -1 && index > selfAt ? index - 1 : index;
    },
    [tasks]
  );

  // ── Pointer drag ──────────────────────────────────────────────────────────

  const autoScroll = (clientY: number) => {
    if (typeof window.scrollBy !== 'function') return;
    const fromTop = clientY;
    const fromBottom = window.innerHeight - clientY;
    if (fromTop >= AUTOSCROLL_EDGE_PX && fromBottom >= AUTOSCROLL_EDGE_PX) return;
    // Nearest edge wins rather than "top first". On a viewport shorter than two
    // edge zones both are live at once, and testing the top first would scroll
    // a drag near the BOTTOM upwards, away from where the finger is going.
    if (fromTop <= fromBottom) window.scrollBy(0, -AUTOSCROLL_STEP_PX);
    else window.scrollBy(0, AUTOSCROLL_STEP_PX);
  };

  const beginDrag = (e: React.PointerEvent, task: Task) => {
    // Left button only; a right-click is a context menu, not a move.
    if (e.button != null && e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* not every environment has capture */
    }
    dragRef.current = { taskId: task.id, originX: e.clientX, originY: e.clientY, moved: false };
  };

  // From the card body. Touch is turned away so a finger dragged across a card
  // still scrolls the page — it gets the grip instead, where `touch-action:
  // none` is scoped to ~8px rather than the whole board.
  const handleCardDown = (e: React.PointerEvent, task: Task) => {
    if (e.pointerType === 'touch') return;
    beginDrag(e, task);
  };

  // From the grip. Takes every pointer type, so a tablet has a handle and a
  // mouse user who happens to grab the stripe isn't left holding a dead strip.
  const handleGripDown = (e: React.PointerEvent, task: Task) => {
    e.stopPropagation();
    beginDrag(e, task);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;

    // Nothing happens until the pointer has actually travelled. Without the
    // slop every click on a card would register as a zero-distance drag.
    if (!current.moved) {
      const far =
        Math.abs(e.clientX - current.originX) > DRAG_SLOP_PX ||
        Math.abs(e.clientY - current.originY) > DRAG_SLOP_PX;
      if (!far) return;
      current.moved = true;
      setDragTaskId(current.taskId);
    }

    autoScroll(e.clientY);

    const under = document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null;
    const columnEl = under?.closest?.('[data-tk-column]');
    // Off the board entirely: forget the last column crossed. Keeping it would
    // mean releasing over the page margin silently drops the card into whichever
    // column the pointer happened to pass through on the way out.
    if (!columnEl) return putDropTarget(null);
    const status = columnEl.getAttribute('data-tk-column') as TaskStatus;

    const cardEl = under!.closest('[data-tk-index]');
    if (!cardEl) return putDropTarget({ status, index: null });

    // Which HALF of the card decides above or below, rather than always above.
    // Geometry, not topmost-node, because the drop line is positioned out of
    // flow precisely so that showing it can't move the card under the pointer
    // and flip the answer on the next frame.
    const box = cardEl.getBoundingClientRect();
    const raw = Number(cardEl.getAttribute('data-tk-index'));
    const index = Number.isNaN(raw)
      ? null
      : raw + (e.clientY > box.top + box.height / 2 ? 1 : 0);
    putDropTarget({ status, index });
  };

  const handleDragUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    if (!current) return;

    const target = dropTargetRef.current;
    setDragTaskId(null);
    putDropTarget(null);
    if (!current.moved) return; // a click, not a move — let the drawer open

    suppressClickRef.current = true;
    if (target) {
      moveTask(
        current.taskId,
        target.status,
        toInsertAt(current.taskId, target.status, target.index)
      );
    }
  };

  // The gesture was taken away — the OS claimed it, the window lost focus, a
  // scroll won. That is not a drop, so nothing moves.
  const handleDragCancel = () => {
    const current = dragRef.current;
    dragRef.current = null;
    suppressClickRef.current = Boolean(current?.moved);
    setDragTaskId(null);
    putDropTarget(null);
  };

  /** True when this click is the tail of a drag and should be dropped. */
  const handleDragClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  // ── Keyboard: Ctrl/⌘ + arrows ─────────────────────────────────────────────
  const handleKeyMove = (task: Task, key: string) => {
    const column = tasks.filter((t) => t.status === task.status);
    const at = column.findIndex((t) => t.id === task.id);

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const next = STATUS_ORDER[STATUS_ORDER.indexOf(task.status) + (key === 'ArrowRight' ? 1 : -1)];
      if (!next) return false;
      if (next === 'done' && !canSignOff) return false;
      // Land at the same depth in the new column where there's room for it,
      // rather than always at the bottom — a card moved across four columns
      // otherwise walks steadily downwards.
      const target = tasks.filter((t) => t.status === next);
      return moveTask(task.id, next, Math.min(at, target.length));
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const to = at + (key === 'ArrowDown' ? 1 : -1);
      if (to < 0 || to >= column.length) return false;
      return moveTask(task.id, task.status, to);
    }

    return false;
  };

  const submitQuickAdd = (status: TaskStatus) => {
    const title = draftTitle.trim();
    setDraftTitle('');
    setAddingIn(null);
    if (title) onQuickAdd({ title, status });
  };

  const startAdding = (status: TaskStatus) => {
    setAddingIn(status);
    setDraftTitle('');
  };

  // A brand-new board is the one state every user is guaranteed to see, and
  // five columns each saying "Nothing here" is five ways of saying nothing.
  // Replace the whole grid with a single invitation that starts the work.
  if (!(allTasks.length || tasks.length)) {
    return (
      <div className="tk flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="tk-first-run-eyebrow">Empty board</p>
        <h3 className="tk-blank-title">What has to happen?</h3>
        <p className="tk-blank-body max-w-md">
          Type a title and the task drawer opens on it, in To Do. Every task needs a due date; add
          a start date too and it lands on the timeline, and mark what it waits on to chain work
          together.
        </p>
        {addingIn === 'todo' ? (
          <input
            autoFocus
            value={draftTitle}
            placeholder="e.g. Reconcile the tastytrade token map"
            aria-label="First task"
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => submitQuickAdd('todo')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitQuickAdd('todo');
              if (e.key === 'Escape') {
                setDraftTitle('');
                setAddingIn(null);
              }
            }}
            className="tk-input mt-2 w-80"
          />
        ) : (
          <button
            type="button"
            onClick={() => startAdding('todo')}
            className="tk-btn tk-btn-primary mt-2"
          >
            <Plus className="h-4 w-4" /> Add the first task
          </button>
        )}
      </div>
    );
  }

  // What the dragged card IS matters to the Done column: a done card dragged
  // around inside it has nowhere to go (the log doesn't reorder), so Done must
  // not light up as a target for it.
  const draggedTask = dragTaskId
    ? (allTasks.length ? allTasks : tasks).find((t) => t.id === dragTaskId)
    : null;

  return (
    // FIVE COLUMNS ACROSS, not a horizontal scroller of fixed-width ones. The
    // whole point of a kanban is seeing every column at once; a board you have
    // to scroll sideways to read is a list with extra steps.
    <div className="tk tk-board" role="list">
      {columns.map((column) => {
        const isTargetColumn = dropTarget?.status === column.value;
        const isDoneColumn = column.value === 'done';
        // Done accepts a drop only from OUTSIDE itself, and always at the top —
        // that is where the newest entry of a newest-first log lands, so the
        // line shows the truth instead of tracking a pointer position the drop
        // would ignore.
        //
        // …and never from anybody who cannot sign this board's work off. The
        // column still DRAWS — it is the log of what has been finished, and
        // hiding it from the person who did most of the finishing would be
        // absurd — it simply stops accepting a card. The heading says why, so a
        // drag that goes nowhere is explained rather than merely ignored.
        const barredFromDone = isDoneColumn && !canSignOff;
        const acceptsDrop =
          (!isDoneColumn || Boolean(draggedTask && draggedTask.status !== 'done')) &&
          !barredFromDone;
        const visibleCards =
          isDoneColumn && !showAllDone ? column.tasks.slice(0, DONE_VISIBLE) : column.tasks;
        const folded = isDoneColumn ? column.tasks.length - visibleCards.length : 0;

        return (
          <section
            key={column.value}
            /* The drag hit-tests with elementFromPoint, which hands back a node
               rather than a React element — these attributes are how it works
               out which column and which slot that node belongs to. */
            data-tk-column={column.value}
            role="listitem"
            aria-label={column.label}
            className={cn('tk-column', dragTaskId && isTargetColumn && acceptsDrop && 'tk-column-over')}
          >
            <header className="tk-column-head">
              <span
                className="tk-column-dot"
                style={{ background: `var(${STATUS_VAR[column.value]})` }}
                aria-hidden="true"
              />
              <h3>{column.label}</h3>
              {/* The column NAMES its reviewer rather than silently swallowing
                  drags. A card that will not drop and says nothing reads as the
                  board being broken; a column headed "X signs off" reads as the
                  board working, and tells you who to go to. */}
              {barredFromDone && (
                <span
                  className="tk-column-note"
                  title={`Work on this board is signed off by ${signOffBy}`}
                >
                  {signOffBy} signs off
                </span>
              )}
              <span className="tk-column-count">{column.tasks.length}</span>
              <button
                type="button"
                onClick={() => startAdding(column.value)}
                aria-label={`Add a task to ${column.label}`}
                title={`Add a task to ${column.label}`}
                className="tk-column-add"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </header>

            <div className="tk-column-list">
              {visibleCards.map((task, i) => (
                <div key={task.id} data-tk-index={i} className="relative">
                  {/* Out of flow, deliberately. An in-flow line pushes the card
                      under the pointer down by its own height, which moves the
                      pointer into the previous card's half and flips the answer
                      on the next frame — the line then oscillates between two
                      slots and the drop lands wherever it happened to stop.

                      Done draws its line at the TOP whatever the pointer says:
                      the drop ignores position there, so the line must too. */}
                  {isTargetColumn &&
                    acceptsDrop &&
                    (isDoneColumn
                      ? i === 0
                      : dropTarget!.index === i && dragTaskId !== task.id) && (
                      <div
                        aria-hidden="true"
                        className="absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-primary"
                      />
                    )}
                  <TaskCard
                    task={task}
                    today={today}
                    waiting={blockers?.get(task.id)}
                    isDragging={dragTaskId === task.id}
                    onOpen={onOpenTask}
                    onCardDown={handleCardDown}
                    onGripDown={handleGripDown}
                    onDragMove={handleDragMove}
                    onDragUp={handleDragUp}
                    onDragCancel={handleDragCancel}
                    onDragClick={handleDragClick}
                    onKeyMove={handleKeyMove}
                  />
                </div>
              ))}

              {/* The tail slot: dropping past the last card, or anywhere in the
                  column's empty space. In flow, because there is no card below
                  it for the line to shove out from under the pointer. */}
              {isTargetColumn &&
                acceptsDrop &&
                (isDoneColumn
                  ? visibleCards.length === 0
                  : dropTarget!.index === null ||
                    dropTarget!.index >= column.tasks.length) && (
                  <div aria-hidden="true" className="h-0.5 rounded-full bg-primary" />
                )}

              {/* The fold. Done never deletes and never forgets — past the
                  recent handful it folds, and the fold says how much history it
                  is holding. The count badge above always tells the whole
                  truth, folded or not. */}
              {folded > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllDone(true)}
                  className="tk-rail-count w-full py-1 text-muted-foreground hover:text-foreground"
                >
                  …and {folded} finished earlier
                </button>
              )}
              {isDoneColumn && showAllDone && column.tasks.length > DONE_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllDone(false)}
                  className="tk-rail-count w-full py-1 text-muted-foreground hover:text-foreground"
                >
                  Show recent only
                </button>
              )}

              {addingIn === column.value && (
                <input
                  autoFocus
                  value={draftTitle}
                  placeholder="What needs doing?"
                  aria-label={`New task in ${column.label}`}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => submitQuickAdd(column.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitQuickAdd(column.value);
                    if (e.key === 'Escape') {
                      setDraftTitle('');
                      setAddingIn(null);
                    }
                  }}
                  className="tk-input"
                />
              )}

              {/* An empty column is a place to put something, so make the space
                  itself the affordance rather than a dead grey line. */}
              {!column.tasks.length && addingIn !== column.value && (
                <button
                  type="button"
                  onClick={() => startAdding(column.value)}
                  className="tk-column-empty"
                >
                  Add a task
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default KanbanBoard;
