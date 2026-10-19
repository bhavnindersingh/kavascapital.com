import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, KanbanSquare, List, Loader2, Plus, Search, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type {
  PlatformUser,
  Task,
  TaskBoard,
  TaskPriority,
  TaskStatus,
  TaskStub,
} from '@/types';
import { tasksApi, taskError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BoardRail from '@/components/tasks/BoardRail';
import GanttView from '@/components/tasks/GanttView';
import KanbanBoard from '@/components/tasks/KanbanBoard';
import PersonView from '@/components/tasks/PersonView';
import TaskDrawer, { type DrawerTask } from '@/components/tasks/TaskDrawer';
import '@/components/tasks/tasks.css';
import TaskListView from '@/components/tasks/TaskListView';
import { marketToday, type Granularity, type Reschedule } from '@/components/tasks/ganttLayout';
import {
  BOARD_COLOURS,
  DEFAULT_BOARD_COLOUR,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  initialsOf,
  isOverdue,
  maySignOff as maySignOffOf,
  personDisc,
} from '@/components/tasks/taskUtils';

/**
 * Tasks — the desk's shared workspace for work that isn't a trade.
 *
 * Boards down the left, one board's tasks in the middle, two ways to look at
 * them (kanban, list), plus a third that reads along the OTHER AXIS: one
 * person's work across every live board.
 *
 * Both views render the SAME rows from the same fetch. Switching never
 * refetches and never filters differently — if a task is missing from one view
 * it is because a filter hid it, not because the views disagree.
 *
 * FILTERING IS THIS PAGE'S JOB, not the views'. `visible` is computed once here
 * and handed down, and the "nothing matches" state is rendered here too, in
 * place of the view. A view asked to render zero rows cannot tell "the board is
 * empty" from "your filter hid everything", and both would answer with the
 * first — telling you a board holding a dozen tasks was empty.
 */

const UNASSIGNED = 'none';
const ANYONE = 'all';

/**
 * Three ways to read one board, and TWO for a person — the split is deliberate.
 *
 * Person mode gets no KANBAN: `sort_order` is per board, so a cross-board column
 * would have an order that means nothing and a drag that renumbers a column it
 * is only showing a slice of. But the TIMELINE applies perfectly well — a bar is
 * placed by the task's own dates, and a date means the same thing on every
 * board, so the objection to the kanban simply does not arise. One person's work
 * on one axis of time is what answers "what is running at once, and what is
 * stacked behind what", which the grouped list can only answer a bucket at a
 * time.
 */
const BOARD_VIEWS = [
  { value: 'board', label: 'Board', icon: KanbanSquare },
  { value: 'timeline', label: 'Timeline', icon: CalendarRange },
  { value: 'list', label: 'List', icon: List },
] as const;

const PERSON_VIEWS = [
  { value: 'person', label: 'My work', icon: User },
  { value: 'timeline', label: 'Timeline', icon: CalendarRange },
] as const;

type ViewKey = 'board' | 'timeline' | 'list' | 'person';

const TasksPage: React.FC = () => {
  const { user } = useAuthStore();

  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [personMode, setPersonMode] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [foreign, setForeign] = useState<TaskStub[]>([]);
  const [people, setPeople] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [view, setView] = useState<ViewKey>('board');
  const [granularity, setGranularity] = useState<Granularity>('day');
  // The desk's day, read once per render rather than inside the date helpers —
  // that is what keeps every one of them deterministic and testable.
  const today = marketToday();

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>(ANYONE);
  const [priorityFilter, setPriorityFilter] = useState<string>(ANYONE);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [undatedOnly, setUndatedOnly] = useState(false);
  // Done work is the board's history and shows by default; the toggle is for
  // clearing the decks, not for hiding what happened.
  const [showDone, setShowDone] = useState(true);
  /**
   * WHOSE work the person axis is showing.
   *
   * A picker, not the logged-in user. "What is on me" is the common question
   * but it is not the only one — a board owner asks "what is on Priya" before a
   * one-to-one, and "what is on nobody" before handing work out. Seeded to the
   * viewer once the roster lands.
   */
  const [personId, setPersonId] = useState<string>('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');

  /**
   * What the drawer is showing. A `DrawerTask` rather than an id, because the
   * drawer is also the CREATE form: quick-add on a column opens it prefilled
   * and unsaved, so there is no id to hold yet.
   */
  const [drawerTask, setDrawerTask] = useState<DrawerTask | null>(null);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;
  const mayFinishHere = maySignOffOf(activeBoard, user?.id);
  const mayAppointOwner = user?.role === 'super_admin';
  const activePerson =
    personId && personId !== UNASSIGNED
      ? (people.find((p) => String(p.id) === personId) ?? null)
      : null;

  // ── Loads ────────────────────────────────────────────────────────────────
  const loadBoards = useCallback(async (): Promise<TaskBoard[]> => {
    const { boards: rows } = await tasksApi.getBoards();
    setBoards(rows);
    return rows;
  }, []);

  const loadTasks = useCallback(
    async (boardId: number | null, person: boolean, wanted: string) => {
      setLoadingTasks(true);
      try {
        const res = person
          ? await tasksApi.getTasksForPerson(
              wanted === UNASSIGNED ? UNASSIGNED : Number(wanted)
            )
          : boardId !== null
            ? await tasksApi.getTasks(boardId)
            : { tasks: [], foreign_tasks: [] };
        setTasks(res.tasks);
        // Never dropped: without it a "Waiting on …" chip would answer only
        // when both ends happened to land in the same fetch.
        setForeign(res.foreign_tasks);
      } catch (err) {
        toast.error(taskError(err, 'Could not load tasks.'));
      } finally {
        setLoadingTasks(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, roster] = await Promise.all([loadBoards(), tasksApi.getPeople()]);
        if (cancelled) return;
        setPeople(roster.people);
        // Seeded, not hardcoded: the picker can be moved off you afterwards.
        // Only ever fires while it is still empty, so it cannot fight a choice.
        setPersonId((cur) => cur || String(user?.id ?? UNASSIGNED));
        const firstLive = rows.find((b) => !b.is_archived);
        // SEED ONLY IF NOTHING IS CHOSEN YET. This resolves after a round trip,
        // and the rail is already on screen and clickable while it is in
        // flight — so a plain `setActiveBoardId(firstLive.id)` silently threw
        // away a board the user had already picked, snapping them back to the
        // first one. The functional form makes the write conditional on the
        // state at the time it lands rather than on what was true when the
        // fetch started.
        if (firstLive) setActiveBoardId((current) => current ?? firstLive.id);
      } catch (err) {
        if (!cancelled) toast.error(taskError(err, 'Could not load the boards.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBoards]);

  useEffect(() => {
    if (loading) return;
    if (personMode && !personId) return; // the roster hasn't landed yet
    loadTasks(activeBoardId, personMode, personId);
  }, [activeBoardId, personMode, personId, loading, loadTasks]);

  // The two axes offer different views, and Timeline is the one they share.
  // Crossing over on a view the other axis does not have would leave `view`
  // naming nothing and the pane blank — so land on that axis's first view,
  // keeping Timeline when it was already showing.
  useEffect(() => {
    setView((v) => {
      if (v === 'timeline') return v;
      return personMode ? 'person' : 'board';
    });
  }, [personMode]);

  const refresh = useCallback(async () => {
    await Promise.all([loadBoards(), loadTasks(activeBoardId, personMode, personId)]);
  }, [loadBoards, loadTasks, activeBoardId, personMode, personId]);

  // ── Filtering ────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !(t.description ?? '').toLowerCase().includes(q))
        return false;
      if (ownerFilter === UNASSIGNED && t.assignee_user_id !== null) return false;
      if (ownerFilter !== ANYONE && ownerFilter !== UNASSIGNED) {
        if (t.assignee_user_id !== Number(ownerFilter)) return false;
      }
      if (priorityFilter !== ANYONE && t.priority !== priorityFilter) return false;
      if (overdueOnly && !isOverdue(t)) return false;
      // "Undated" means work still to be scheduled — a finished task without a
      // due date was never going to be scheduled and is not the answer here.
      if (undatedOnly && (t.due_date || t.status === 'done')) return false;
      if (!showDone && t.status === 'done') return false;
      return true;
    });
  }, [tasks, search, ownerFilter, priorityFilter, overdueOnly, undatedOnly, showDone]);

  const filtersActive =
    Boolean(search.trim()) ||
    ownerFilter !== ANYONE ||
    priorityFilter !== ANYONE ||
    overdueOnly ||
    undatedOnly ||
    !showDone;

  const clearFilters = () => {
    setSearch('');
    setOwnerFilter(ANYONE);
    setPriorityFilter(ANYONE);
    setOverdueOnly(false);
    setUndatedOnly(false);
    setShowDone(true);
  };

  const filtered = visible.length !== tasks.length;

  /**
   * task id → the unfinished work it is waiting on, for the "Waiting on …"
   * chip every view shows.
   *
   * Built from the FULL fetch plus `foreign_tasks`, never from `visible`: a
   * prerequisite hidden by a filter, or sitting on another board, is still
   * holding the work up. Deriving it from what happens to be on screen is how
   * the chip comes and goes depending on where you are standing.
   *
   * A prerequisite already DONE is dropped — it is not holding anything up any
   * more, and a card still saying "Waiting on" work that finished last week is
   * the chip lying.
   */
  const blockers = useMemo(() => {
    const byId = new Map<number, { id: number; title: string; status: string }>();
    for (const t of tasks) byId.set(t.id, t);
    for (const f of foreign) if (!byId.has(f.id)) byId.set(f.id, f);

    const map = new Map<number, Task[]>();
    for (const t of tasks) {
      const waiting = t.blocked_by
        .map((id) => byId.get(id))
        .filter((w): w is Task => Boolean(w) && w!.status !== 'done');
      if (waiting.length) map.set(t.id, waiting);
    }
    return map;
  }, [tasks, foreign]);

  // ── Writes ───────────────────────────────────────────────────────────────
  const applyTask = (updated: Task) =>
    setTasks((rows) => rows.map((t) => (t.id === updated.id ? updated : t)));

  /**
   * A drag, written optimistically: the card lands where it was dropped and
   * only a failed write pulls it back. The whole destination column is
   * renumbered by the view; the previous rows are kept so a rejection can
   * restore them exactly.
   */
  const moveTasks = async (
    updates: { id: number; status?: TaskStatus; sort_order: number }[]
  ) => {
    const before = tasks;
    setTasks((rows) =>
      rows.map((t) => {
        const u = updates.find((x) => x.id === t.id);
        return u ? { ...t, sort_order: u.sort_order, ...(u.status ? { status: u.status } : {}) } : t;
      })
    );
    try {
      await tasksApi.reorderTasks(updates);
      // The completion stamp is the server's to write, and a card dropped into
      // Done gains one — so the rows are re-read rather than assumed.
      if (updates.some((u) => u.status === 'done')) await refresh();
      else await loadBoards();
    } catch (err) {
      setTasks(before);
      toast.error(taskError(err, 'That move was not saved.'));
    }
  };

  /**
   * A bar dragged on the timeline. Optimistic like the kanban drop, and for the
   * same reason: a bar that snaps back to where it started on every drag feels
   * broken even when the write succeeds a moment later.
   *
   * The server holds `due_date >= start_date` as a CHECK constraint and the
   * drag arithmetic clamps to the same rule, so a rejection here means
   * something else went wrong — show its sentence and put the bar back.
   */
  const reschedule = async (task: Task, dates: Reschedule) => {
    const before = tasks;
    setTasks((rows) =>
      rows.map((t) =>
        t.id === task.id ? { ...t, start_date: dates.startDate, due_date: dates.dueDate } : t
      )
    );
    try {
      const { task: updated } = await tasksApi.updateTask(task.id, {
        start_date: dates.startDate,
        due_date: dates.dueDate,
      });
      applyTask(updated);
    } catch (err) {
      setTasks(before);
      toast.error(taskError(err, 'That date change was not saved.'));
    }
  };

  /**
   * Quick-add from a column, and the "New task" button.
   *
   * NEITHER WRITES A ROW. Both open the drawer prefilled and unsaved, because
   * the drawer is the one create path and it is the one that asks for a
   * deadline. A second door that wrote straight through would go on minting
   * undated tasks for ever — the rule would hold on the form nobody uses in a
   * hurry and fail on the one everybody does. (This started life as a
   * `window.prompt`, which was both: a centred browser dialog nothing in this
   * app looks like, and a door that skipped every field but the title.)
   */
  const quickAdd = ({ title, status }: { title: string; status: TaskStatus }) => {
    if (activeBoardId === null) return;
    setDrawerTask({ board_id: activeBoardId, title, status, priority: 'medium', progress: 0 });
  };


  /** One-field board writes from the board bar. Only what moved is sent. */
  const patchBoard = async (board: TaskBoard, patch: Record<string, unknown>) => {
    const before = boards;
    setBoards((rows) => rows.map((b) => (b.id === board.id ? { ...b, ...patch } : b)));
    try {
      await tasksApi.updateBoard(board.id, patch as never);
      await loadBoards();
    } catch (err) {
      setBoards(before);
      toast.error(taskError(err));
    }
  };

  const setBoardColour = (board: TaskBoard, color: string) => {
    setPaletteOpen(false);
    if ((board.color || DEFAULT_BOARD_COLOUR) === color) return;
    patchBoard(board, { color });
  };

  const saveDescription = (board: TaskBoard) => {
    setEditingDescription(false);
    const next = descriptionDraft.trim() || null;
    if (next === (board.description ?? null)) return;
    patchBoard(board, { description: next });
  };

  /** A board is created from the rail with one field: its name. */
  const createBoardInline = async (name: string) => {
    try {
      const { board } = await tasksApi.createBoard({ name });
      setActiveBoardId(board.id);
      setPersonMode(false);
      await loadBoards();
      toast.success(`"${board.name}" created`);
    } catch (err) {
      toast.error(taskError(err, 'That board was not created.'));
    }
  };

  const setBoardOwner = (board: TaskBoard, value: string) => {
    const next = value === UNASSIGNED ? null : Number(value);
    if (next === (board.owner_user_id ?? null)) return;
    patchBoard(board, { owner_user_id: next });
  };

  const archiveBoard = async (board: TaskBoard, archived: boolean) => {
    try {
      await tasksApi.updateBoard(board.id, { is_archived: archived });
      const rows = await loadBoards();
      // An archived board that stayed selected would keep a finished project on
      // screen with no way back to live work.
      if (archived && board.id === activeBoardId) {
        setActiveBoardId(rows.find((b) => !b.is_archived)?.id ?? null);
      }
      toast.success(archived ? 'Board archived' : 'Board restored');
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  /**
   * Delete a board and everything on it.
   *
   * NO `window.confirm` HERE. The rail's menu arms the press in place and needs
   * a second tap within four seconds — a centred OS dialog is the one thing on
   * this screen that looks like nothing else on it, it cannot name the board or
   * say how many tasks go with it, and it trains people to dismiss it.
   *
   * The real guard is the server's anyway: it refuses while any task is
   * unfinished and answers with a sentence saying how many and offering
   * Archive instead.
   */
  const deleteBoard = async (board: TaskBoard) => {
    try {
      const res = await tasksApi.deleteBoard(board.id);
      const rows = await loadBoards();
      if (board.id === activeBoardId) {
        setActiveBoardId(rows.find((b) => !b.is_archived)?.id ?? null);
      }
      toast.success(
        `"${board.name}" deleted · ${res.tasks_deleted} task${res.tasks_deleted === 1 ? '' : 's'}`
      );
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  const reorderBoards = async (updates: { id: number; sort_order: number }[]) => {
    const before = boards;
    setBoards((rows) =>
      [...rows].map((b) => {
        const u = updates.find((x) => x.id === b.id);
        return u ? { ...b, sort_order: u.sort_order } : b;
      })
    );
    try {
      await tasksApi.reorderBoards(updates);
      await loadBoards();
    } catch (err) {
      setBoards(before);
      toast.error(taskError(err));
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    // `.tk` scopes the task board's metric + colour tokens (see tasks.css).
    <div className="tk flex h-[calc(100vh-4rem)] overflow-hidden">
      <BoardRail
        boards={boards}
        activeBoardId={activeBoardId}
        onSelect={(id) => {
          setActiveBoardId(id);
          setPersonMode(false);
        }}
        onCreateInline={createBoardInline}
        onRename={(board, name) => patchBoard(board, { name })}
        onArchive={archiveBoard}
        onDelete={deleteBoard}
        onReorder={reorderBoards}
        personMode={personMode}
        onPersonMode={() => setPersonMode(true)}
        user={user}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {/* ── The person bar: WHOSE work, chosen here ─────────────────── */}
          {personMode ? (
            <div className="flex items-center gap-3">
              <span
                className="tk-avatar tk-avatar-lg"
                style={personDisc(activePerson?.full_name)}
                aria-hidden="true"
              >
                {activePerson ? initialsOf(activePerson.full_name) : <User className="h-4 w-4" />}
              </span>
              <div>
                <label className="flex items-center gap-2">
                  <span className="tk-label">Showing</span>
                  <select
                    className="tk-input"
                    style={{ width: 'auto' }}
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                    aria-label="Whose work to show"
                  >
                    {people.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.id === user?.id ? `${p.full_name} (you)` : p.full_name}
                      </option>
                    ))}
                    {/* Unassigned work is nobody's queue, but it is somebody's
                        problem — it belongs in the same picker so it can be
                        found and given out. */}
                    <option value={UNASSIGNED}>Unassigned</option>
                  </select>
                </label>
                <p className="tk-boardbar-desc mt-0.5">Every board, in the order it has to happen.</p>
              </div>
            </div>
          ) : activeBoard ? (
            /* ── The board bar: which board, what it is for, who signs it off ── */
            <div className="flex items-start gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPaletteOpen((v) => !v)}
                  aria-expanded={paletteOpen}
                  aria-label={`Colour for ${activeBoard.name}`}
                  title="Board colour"
                  className="mt-1 h-6 w-6 rounded-[3px] border border-border"
                  style={{ background: activeBoard.color || DEFAULT_BOARD_COLOUR }}
                />
                {paletteOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setPaletteOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      role="group"
                      aria-label="Board colour"
                      className="absolute left-0 top-9 z-50 grid grid-cols-4 gap-1.5 rounded-[3px] border border-border bg-card p-2 shadow-lg"
                    >
                      {BOARD_COLOURS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setBoardColour(activeBoard, c)}
                          aria-label={`Use ${c}`}
                          style={{ background: c }}
                          className={cn(
                            'h-5 w-5 rounded-full',
                            (activeBoard.color || DEFAULT_BOARD_COLOUR) === c &&
                              'ring-2 ring-foreground ring-offset-2 ring-offset-card'
                          )}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="min-w-0">
                <h1 className="tk-boardbar-name">{activeBoard.name}</h1>
                {editingDescription ? (
                  <input
                    autoFocus
                    className="tk-input mt-1"
                    value={descriptionDraft}
                    placeholder="What is this board for?"
                    aria-label="Board description"
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onBlur={() => saveDescription(activeBoard)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveDescription(activeBoard);
                      if (e.key === 'Escape') setEditingDescription(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={cn('tk-boardbar-desc block text-left', !activeBoard.description && 'italic')}
                    onClick={() => {
                      setDescriptionDraft(activeBoard.description || '');
                      setEditingDescription(true);
                    }}
                  >
                    {activeBoard.description || 'Add a description'}
                  </button>
                )}

                {/* THE SIGN-OFF, named on the board it governs. `quality_check`
                    means "finished, not yet signed off", and without this the
                    column never said BY WHOM — so work could sit there with the
                    doer believing it was somebody's and nobody believing it was
                    theirs. It lives here rather than in the rail's ⋯ menu
                    because it is a fact about the project you read, not an
                    upkeep action you occasionally perform.

                    Left LIVE for a non-admin and answering with the reason,
                    rather than `disabled`: a disabled select shows no title and
                    a tap does nothing, which on a tablet is the whole feedback.
                    The route is the authority either way. */}
                <label className="mt-1.5 flex items-center gap-2">
                  <span className="tk-label">Board owner</span>
                  <select
                    className="tk-input"
                    style={{ width: 'auto' }}
                    value={activeBoard.owner_user_id ?? UNASSIGNED}
                    aria-disabled={!mayAppointOwner || undefined}
                    title={
                      mayAppointOwner
                        ? "Who signs off this board's finished work"
                        : 'Only an admin can change who signs off this board’s work'
                    }
                    onChange={(e) =>
                      mayAppointOwner
                        ? setBoardOwner(activeBoard, e.target.value)
                        : toast.error(
                            "Only an admin can change who signs off this board's work."
                          )
                    }
                  >
                    <option value={UNASSIGNED}>No owner — anyone may finish</option>
                    {people.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="tk-boardbar-name">Tasks</h1>
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="h-8 w-40 pl-8 text-meta"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* The owner filter is meaningless in person mode — every row is
                already one person's. */}
            {!personMode && (
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-8 w-36 text-meta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANYONE}>Anyone</SelectItem>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Three toggles rather than three more dropdowns: each is a
                yes/no about the whole board, and a select that says "Any /
                Overdue" spends a control on stating the default. */}
            <div className="tk-seg" role="group" aria-label="Filters">
              <button
                type="button"
                aria-pressed={overdueOnly}
                onClick={() => setOverdueOnly((v) => !v)}
                className={cn('tk-seg-btn', overdueOnly && 'tk-seg-on')}
                title="Only work past its due date"
              >
                Overdue
              </button>
              <button
                type="button"
                aria-pressed={undatedOnly}
                onClick={() => setUndatedOnly((v) => !v)}
                className={cn('tk-seg-btn', undatedOnly && 'tk-seg-on')}
                title="Only unfinished work with no due date"
              >
                Undated
              </button>
              <button
                type="button"
                aria-pressed={showDone}
                onClick={() => setShowDone((v) => !v)}
                className={cn('tk-seg-btn', showDone && 'tk-seg-on')}
                title="Show finished work"
              >
                Done
              </button>
            </div>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-32 text-meta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANYONE}>Any priority</SelectItem>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p as TaskPriority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Three tabs on a board, two for a person — see BOARD_VIEWS. */}
            <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)}>
              <TabsList className="h-8">
                {(personMode ? PERSON_VIEWS : BOARD_VIEWS).map((v) => {
                  const Icon = v.icon;
                  return (
                    <TabsTrigger key={v.value} value={v.value} className="h-6 px-2 text-meta">
                      <Icon className="mr-1 h-3.5 w-3.5" /> {v.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            {/* A new task needs a board to land on, and the person view spans
                all of them — offering it there would mean asking which board,
                or guessing. */}
            {!personMode && activeBoardId !== null && (
              <Button
                size="sm"
                onClick={() =>
                  setDrawerTask({
                    board_id: activeBoardId,
                    status: 'todo',
                    priority: 'medium',
                    progress: 0,
                  })
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New task
              </Button>
            )}
          </div>
        </div>

        {/* Says what the filters are hiding, where the filters are — a count
            that disagrees with the rail's badge is otherwise unexplained. */}
        {filtersActive && visible.length !== tasks.length && visible.length > 0 && (
          <p className="tk-filter-note border-b border-border px-4 py-1.5">
            Showing {visible.length} of {tasks.length} tasks.{' '}
            <button type="button" className="underline hover:text-foreground" onClick={clearFilters}>
              Clear filters
            </button>
          </p>
        )}

        {/* ── The view ─────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {loadingTasks ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !personMode && activeBoardId === null ? (
            <EmptyState
              title="No board selected"
              // The + in the rail is where a board is made, and it is on
              // screen — pointing at it beats a second button that does the
              // same thing from a different place.
              body="Make one with the + above the rail. A board is a project — “Broker migration”, “Q4 strategy review”."
            />
          ) : visible.length === 0 && filtered ? (
            // Rendered HERE rather than inside a view, because a view handed
            // zero rows would say the board was empty when a filter hid them.
            <EmptyState
              title="Nothing matches"
              body="Every task on this board is hidden by the current filters."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title={personMode ? 'Nothing on you' : 'This board is empty'}
              body={
                personMode
                  ? 'No open work is assigned to you on any live board.'
                  : 'Add the first task and it will appear in To Do.'
              }
              action={
                !personMode && activeBoardId !== null ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      setDrawerTask({
                        board_id: activeBoardId,
                        status: 'todo',
                        priority: 'medium',
                        progress: 0,
                      })
                    }
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> New task
                  </Button>
                ) : undefined
              }
            />
          ) : view === 'timeline' ? (
            <GanttView
              tasks={visible}
              today={today}
              granularity={granularity}
              onGranularityChange={setGranularity}
              blockers={blockers}
              onOpenTask={setDrawerTask}
              onReschedule={reschedule}
              showBoard={personMode}
            />
          ) : view === 'person' ? (
            <PersonView
              tasks={visible}
              today={today}
              blockers={blockers}
              onOpenTask={setDrawerTask}
            />
          ) : view === 'list' ? (
            <TaskListView
              tasks={visible}
              today={today}
              blockers={blockers}
              onOpenTask={setDrawerTask}
              showBoard={personMode}
            />
          ) : (
            <KanbanBoard
              tasks={visible}
              // The WHOLE board, so a drop renumbers against every card and not
              // just the ones a filter is showing.
              allTasks={tasks}
              today={today}
              blockers={blockers}
              onOpenTask={setDrawerTask}
              onQuickAdd={quickAdd}
              onReorder={moveTasks}
              canSignOff={mayFinishHere}
              signOffBy={activeBoard?.owner_name ?? "this board's owner"}
            />
          )}
        </div>
      </main>

      <TaskDrawer
        task={drawerTask}
        // On the person axis the board rides on the task itself, because My
        // Work spans boards and each has its own owner — without it the drawer
        // could not know whether this person may close THIS task.
        board={personMode ? (drawerTask?.board ?? null) : activeBoard}
        siblings={tasks}
        foreign={foreign}
        people={people}
        user={user}
        onClose={() => setDrawerTask(null)}
        onSaved={(t) => {
          applyTask(t);
          setDrawerTask(t);
          loadBoards();
        }}
        onCreated={(t) => {
          setTasks((rows) => [...rows, t]);
          // Re-point the drawer at the saved row rather than closing it: the
          // checklist, files and links it could not offer a moment ago are now
          // available, and closing would make the user open it again to reach
          // the very fields the create form told them about.
          setDrawerTask(t);
          loadBoards();
        }}
        onDeleted={(id) => {
          setTasks((rows) => rows.filter((t) => t.id !== id));
          setDrawerTask(null);
          loadBoards();
        }}
        onGraphChanged={refresh}
      />

    </div>
  );
};

const EmptyState: React.FC<{ title: string; body: string; action?: React.ReactNode }> = ({
  title,
  body,
  action,
}) => (
  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
    <p className="text-body font-medium text-foreground">{title}</p>
    <p className="max-w-sm text-meta text-muted-foreground">{body}</p>
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export default TasksPage;
