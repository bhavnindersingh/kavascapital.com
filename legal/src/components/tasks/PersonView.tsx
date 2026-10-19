import React, { useMemo, useState } from 'react';
import { Clock, Link2, User } from 'lucide-react';
import type { Task } from '@/types';
import { cn } from '@/lib/utils';
import { daysUntilDue, formatSpanLabel, isOverdue } from './ganttLayout';
import { PRIORITY_VAR, STATUS_LABELS, STATUS_VAR } from './taskUtils';
import './tasks.css';

/**
 * One person's work, across every board. The fourth view — and the only one
 * that reads along the other axis: the board views answer "what is left on this
 * project", this answers "what is on me", which is the question anyone actually
 * opens the app with.
 *
 * Still the same rows from the same table. Nothing here is a person-specific
 * column or a second source of truth; it is a different sort of the same data,
 * and a task edited here is edited everywhere.
 *
 * GROUPED BY WHEN, NOT BY BOARD. Grouping by board would rebuild the rail in
 * the middle of the pane and answer a question the rail already answers. What a
 * person needs from a combined list is an ORDER TO WORK IN, so the groups are
 * time and the board rides along as a label on the row. Overdue first, then
 * today, and "no date" last because an undated task is not urgent, it is
 * unplanned.
 */

/**
 * The buckets, in the order they are read. `test` takes the days-until-due —
 * null when the task carries no date at all.
 *
 * "Next seven days" is a rolling window rather than "until Sunday": a list that
 * empties itself every Sunday night and refills on Monday tells you less on a
 * Friday than a rolling window does.
 */
const BUCKETS = [
  {
    key: 'overdue',
    title: 'Overdue',
    note: 'Past its due date. This is the only crimson on the board.',
    test: (d: number | null) => d !== null && d < 0,
  },
  { key: 'today', title: 'Today', note: null, test: (d: number | null) => d === 0 },
  {
    key: 'week',
    title: 'Next seven days',
    note: null,
    test: (d: number | null) => d !== null && d > 0 && d <= 7,
  },
  { key: 'later', title: 'Later', note: null, test: (d: number | null) => d !== null && d > 7 },
  {
    key: 'undated',
    title: 'No date yet',
    note: 'Not on the timeline until it has one.',
    test: (d: number | null) => d === null,
  },
];

/**
 * Done work is grouped by BEING DONE, whenever it was due — a task finished
 * last month is not "overdue", and bucketing it by date would put a finished
 * job at the top of a list of problems.
 *
 * It is also a LOG: ordered by when it finished, newest first, and folded past
 * the recent handful. This group is the union of every live board's Done
 * column, so it is the fastest-growing list here — without the fold it would
 * bury nothing today but everything by December. History stays one tap away;
 * nothing is deleted.
 */
const DONE_VISIBLE = 8;
const doneKey = (t: Task) => t.completed_at || '9999';
const byFinishedDesc = (a: Task, b: Task) => doneKey(b).localeCompare(doneKey(a));

/**
 * The same wording the card uses, and the same silence, for the same reason. A
 * DEADLINE IS A CLAIM ABOUT WORK STILL TO BE DONE, and the Done group at the
 * foot of this view has already answered it, so a finished row states no date
 * at all.
 *
 * The done case returns an EMPTY STRING, never "—". A dash is what an undated
 * row reads one bucket up in this same view, and finished is not undated.
 *
 * `TaskListView` deliberately does NOT do this. Its Due column is headed and
 * sortable, and hiding the value you have just sorted on is the worse trade.
 */
const dueLabel = (task: Task, today: string) => {
  if (task.status === 'done') return '';
  const days = daysUntilDue(task, today);
  if (days === null) return '—';
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return 'Yesterday';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return formatSpanLabel(task.due_date);
};

export interface PersonViewProps {
  tasks: Task[];
  today: string;
  blockers: Map<number, Task[]>;
  onOpenTask: (t: Task) => void;
}

export const PersonView: React.FC<PersonViewProps> = ({
  tasks,
  today,
  blockers,
  onOpenTask,
}) => {
  const [allDone, setAllDone] = useState(false);

  const groups = useMemo(() => {
    const done: Task[] = [];
    const rest: Task[] = [];
    tasks.forEach((t) => (t.status === 'done' ? done : rest).push(t));

    const filled = BUCKETS.map((bucket) => ({
      key: bucket.key,
      title: bucket.title,
      note: bucket.note as string | null,
      tasks: rest.filter((t) => bucket.test(daysUntilDue(t, today))),
    }));
    if (done.length) {
      filled.push({
        key: 'done',
        title: 'Done',
        note: null,
        tasks: [...done].sort(byFinishedDesc),
      });
    }

    // An empty bucket is not a heading. Four "Nothing here" rows down a page is
    // four ways of saying the same nothing.
    return filled.filter((g) => g.tasks.length);
  }, [tasks, today]);

  if (!tasks.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <User className="h-6 w-6 text-muted-foreground" />
        <h3 className="text-body font-medium">Nothing assigned</h3>
        <p className="max-w-sm text-meta text-muted-foreground">
          No task on any board has this person as its owner. Open a board and set an owner on the
          tasks they are carrying.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto pr-1">
      {groups.map((group) => {
        // The Done group folds; every other bucket is live work and shows whole.
        const foldable = group.key === 'done' && group.tasks.length > DONE_VISIBLE;
        const rows = foldable && !allDone ? group.tasks.slice(0, DONE_VISIBLE) : group.tasks;
        return (
          <section key={group.key}>
            <header className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h3
                className={cn(
                  'text-eyebrow font-bold uppercase tracking-widest',
                  group.key === 'overdue' ? 'text-danger-400' : 'text-muted-foreground'
                )}
              >
                {group.title}
              </h3>
              <span className="rounded bg-muted px-1.5 py-0.5 text-micro font-bold tabular-nums text-muted-foreground">
                {group.tasks.length}
              </span>
              {group.note && (
                <p className="text-eyebrow text-muted-foreground">{group.note}</p>
              )}
            </header>

            <div className="overflow-hidden rounded-lg border border-border">
              {/* No sortable header. The order IS the answer here — the groups
                  are already sorted by when, and letting the reader re-sort by
                  title would take the one thing this view adds and throw it
                  away. The list view is one tab over for that. */}
              <table className="w-full border-collapse text-body">
                <tbody>
                  {rows.map((task) => {
                    const late = isOverdue(task, today);
                    const waiting = blockers?.get(task.id);
                    return (
                      <tr
                        key={task.id}
                        onClick={() => onOpenTask(task)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onOpenTask(task);
                        }}
                        className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent focus:bg-accent focus:outline-none"
                      >
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="tk-list-pri"
                              style={{ background: `var(${PRIORITY_VAR[task.priority]})` }}
                              aria-hidden="true"
                            />
                            <span
                              className={cn(
                                'truncate',
                                task.status === 'done' && 'text-muted-foreground line-through'
                              )}
                            >
                              {task.title}
                            </span>
                            {waiting && (
                              <span
                                title={waiting.map((w) => w.title).join(' · ')}
                                className="inline-flex shrink-0 items-center gap-1 rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-micro text-warning-400"
                              >
                                <Link2 className="h-2.5 w-2.5" />
                                {waiting.length === 1
                                  ? `Waiting on ${waiting[0].title}`
                                  : `Waiting on ${waiting.length}`}
                              </span>
                            )}
                          </span>
                        </td>

                        {/* Which project, as TEXT. A board has a colour of its
                            own and this is the one screen where it must not be
                            drawn: a board someone painted crimson would put
                            crimson dots down a list in which crimson means
                            late. */}
                        <td className="px-3 py-2.5 text-meta text-muted-foreground">
                          {task.board?.name || '—'}
                        </td>

                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="tk-column-dot"
                              style={{ background: `var(${STATUS_VAR[task.status]})` }}
                            />
                            {STATUS_LABELS[task.status]}
                          </span>
                        </td>

                        {/* Here the mark reads "4d overdue" rather than a date:
                            this view is already grouped by when, so the useful
                            number is how far past, not which day. */}
                        <td className="w-32 whitespace-nowrap px-3 py-2.5 text-right text-meta tabular-nums">
                          {late ? (
                            <span className="inline-flex whitespace-nowrap items-center gap-1 rounded bg-destructive px-1.5 py-0.5 font-semibold text-destructive-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {dueLabel(task, today)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{dueLabel(task, today)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {foldable && (
              <button
                type="button"
                onClick={() => setAllDone((v) => !v)}
                className="mt-1.5 text-eyebrow text-muted-foreground hover:text-foreground"
              >
                {allDone
                  ? 'Show recent only'
                  : `…and ${group.tasks.length - DONE_VISIBLE} finished earlier`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default PersonView;
