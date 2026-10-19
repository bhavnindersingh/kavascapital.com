import React, { useMemo, useState } from 'react';
import { Clock, Link2 } from 'lucide-react';
import type { Task } from '@/types';
import { cn } from '@/lib/utils';
import { isOverdue, formatSpanLabel, toDayNumber } from './ganttLayout';
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_VAR,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_VAR,
  initialsOf,
  personDisc,
} from './taskUtils';
import './tasks.css';

/**
 * The flat view: every task on the board, sortable, nothing hidden in a column
 * or off the right edge of a timeline. This is the one that answers "what is
 * actually outstanding" and prints sensibly.
 */

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  PRIORITY_ORDER.map((p, i) => [p, i])
);
const STATUS_RANK: Record<string, number> = Object.fromEntries(
  STATUS_ORDER.map((s, i) => [s, i])
);

const COLUMNS = [
  { key: 'title', label: 'Task', numeric: false },
  { key: 'board', label: 'Board', numeric: false },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'priority', label: 'Priority', numeric: false },
  { key: 'assignee', label: 'Owner', numeric: false },
  { key: 'due_date', label: 'Due', numeric: true },
  { key: 'progress', label: 'Progress', numeric: true },
] as const;

/**
 * Undated tasks sort LAST however you are sorting — an absent date is not "the
 * year 1970", and putting it at the top buries the work that has a deadline.
 * The same rule holds for an absent owner.
 */
const compare = (a: Task, b: Task, key: string) => {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'board':
      return (a.board?.name ?? '').localeCompare(b.board?.name ?? '');
    case 'status':
      return (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    case 'priority':
      return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
    case 'progress':
      return (a.progress || 0) - (b.progress || 0);
    case 'assignee': {
      const an = a.assignee_name || '';
      const bn = b.assignee_name || '';
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return an.localeCompare(bn);
    }
    case 'due_date': {
      const ad = toDayNumber(a.due_date);
      const bd = toDayNumber(b.due_date);
      if (ad === null && bd === null) return 0;
      if (ad === null) return 1;
      if (bd === null) return -1;
      return ad - bd;
    }
    default:
      return 0;
  }
};

export interface TaskListViewProps {
  tasks: Task[];
  today: string;
  /** task id → what it waits on, for the "Waiting on …" chip. */
  blockers: Map<number, Task[]>;
  onOpenTask: (t: Task) => void;
  /** Person mode spans boards, so each row has to say which project it is on. */
  showBoard?: boolean;
}

export const TaskListView: React.FC<TaskListViewProps> = ({
  tasks,
  today,
  blockers,
  onOpenTask,
  showBoard,
}) => {
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: 'due_date', dir: 1 });

  const columns = COLUMNS.filter((c) => c.key !== 'board' || showBoard);

  const rows = useMemo(
    () => [...tasks].sort((a, b) => compare(a, b, sort.key) * sort.dir),
    [tasks, sort]
  );

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  return (
    <div className="h-full overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-body">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                }
                className={cn(
                  'border-b border-border px-3 py-2.5 text-eyebrow font-semibold uppercase tracking-widest',
                  c.numeric ? 'text-right' : 'text-left',
                  sort.key === c.key ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {c.label}
                  {sort.key === c.key && (
                    <span aria-hidden="true" className="text-micro">
                      {sort.dir === 1 ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
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
                    {/* A BAR is priority — the same rail the card and the
                        timeline gutter wear. */}
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

                {showBoard && (
                  <td className="px-3 py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: task.board?.color || '#74c8e7' }}
                      />
                      {task.board?.name ?? '—'}
                    </span>
                  </td>
                )}

                <td className="px-3 py-2.5">
                  {/* A DOT is status. */}
                  <span className="inline-flex items-center gap-1.5">
                            <span
                              className="tk-column-dot"
                              style={{ background: `var(${STATUS_VAR[task.status]})` }}
                            />
                            {STATUS_LABELS[task.status]}
                          </span>
                </td>

                <td className="px-3 py-2.5 text-meta text-muted-foreground">
                  {PRIORITY_LABELS[task.priority]}
                </td>

                {/* Same person, same colour as their disc on the board — a dot
                    rather than a disc, because a table row is read across and a
                    25px circle would stop the eye every line. */}
                <td className="px-3 py-2.5 text-meta text-muted-foreground">
                  {task.assignee_name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="tk-avatar tk-avatar-sm"
                        style={personDisc(task.assignee_name)}
                        aria-hidden="true"
                      >
                        {initialsOf(task.assignee_name)}
                      </span>
                      {task.assignee_name}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>

                {/* The same crimson mark the card wears, so a late row is
                    findable scanning down the Due column rather than only by
                    the edge on its title cell. The date itself stays — this
                    column is "Due", and "9 Aug" in crimson says both at once. */}
                <td className="px-3 py-2.5 text-right text-meta tabular-nums">
                  {!task.due_date ? (
                    <span className="text-muted-foreground">—</span>
                  ) : late ? (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 font-semibold text-destructive-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {formatSpanLabel(task.due_date)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {formatSpanLabel(task.due_date)}
                    </span>
                  )}
                </td>

                <td className="px-3 py-2.5 text-right text-meta tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-1 w-14 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${task.progress}%` }}
                      />
                    </span>
                    {task.progress}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TaskListView;
