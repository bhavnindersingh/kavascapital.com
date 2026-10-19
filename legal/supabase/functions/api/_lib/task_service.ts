/**
 * The HQ work board — boards, tasks, checklists, discussion, dependency edges
 * and the activity trail.
 *
 * Port of nightingale's `app/services/task_service.py` (itself ported from the
 * Nimai POS backend). This module holds the DATA RULES; `../tasks.ts` holds the
 * AUTHORITY rules. The completion helpers below state what the database does
 * when a task is finished and have no notion of who is asking, so the routes
 * can decide whether the person asking may finish it without the two questions
 * tangling.
 *
 * The schema (migration 20261018000000, from alembic f1a2b3c4d5e6) carries the
 * foreign keys, CHECK constraints and the LOWER(name) unique index, so what is
 * left here is what needs a *sentence* rather than a constraint violation, plus
 * the two things no constraint can see: dependency cycles, and the completion
 * transition.
 */
import { type Db, execute, fetch, fetchrow, fetchval, type Row, sql, tx } from "./db.ts";

// ── Vocabulary ───────────────────────────────────────────────────────────────
// Mirrored by CHECK constraints on the table; kept here so the API answers
// with a sentence rather than a 500 from a constraint the caller cannot see.

// Which roles may be named as a task's owner or a board's reviewer. The
// router's TASK_ROLES is sourced from this, so the two cannot drift.
export const ASSIGNABLE_ROLES = ["trader", "manager", "super_admin"] as const;

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "quality_check", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// The words a person reads, never the column's key — rule 2 of the trail.
export const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  // "blocked" is a decision somebody made — parked. A task whose prerequisite
  // is unfinished is a different thing and is derived from the edges.
  blocked: "On Hold",
  quality_check: "Quality Check",
  done: "Done",
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Somebody whose login has been removed still reads as a person rather than as
// an id nobody can resolve.
export const UNKNOWN_PERSON = "Someone since removed";

/** A DATE column on the wire: 'YYYY-MM-DD', or null (db.ts already returns strings). */
const day = (value: unknown): string | null => (value ? String(value) : null);

const stamp = (value: unknown): string | null =>
  value ? new Date(value as string | Date).toISOString() : null;

/** A Postgres array literal for a list of validated integer ids. */
const intArray = (ids: Iterable<number>): string => `{${[...ids].map((n) => Math.trunc(n)).join(",")}}`;

// ── Boards ───────────────────────────────────────────────────────────────────

/**
 * The rail. Live boards first, archived last, then by sort_order, then by name
 * (boards created before reorder existed all share sort_order 0).
 *
 * ARCHIVED BOARDS COME BACK TOO: a board that archived itself out of the app
 * would make the gentler option the more destructive one. `open_count` counts
 * OPEN work. The owner's name is JOINED AT READ TIME — a live pointer at
 * whoever holds the job today, the opposite of `task_events.actor_name`.
 */
export async function listBoards(): Promise<Row[]> {
  const rows = await fetch(`
    SELECT b.id, b.name, b.description, b.color, b.is_archived, b.sort_order,
           b.owner_user_id,
           u.full_name AS owner_full_name,
           u.email     AS owner_email,
           b.created_at,
           COALESCE(t.open_count, 0) AS open_count
      FROM task_boards b
      LEFT JOIN users u ON u.id = b.owner_user_id
      LEFT JOIN (
            SELECT board_id, COUNT(*) AS open_count
              FROM tasks
             WHERE status <> 'done'
             GROUP BY board_id
      ) t ON t.board_id = b.id
     ORDER BY b.is_archived, b.sort_order, LOWER(b.name)
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    is_archived: r.is_archived,
    sort_order: r.sort_order,
    open_count: Number(r.open_count),
    owner_user_id: r.owner_user_id,
    // A named owner whose login has gone reads as words, never a raw id.
    owner_name: r.owner_user_id ? (r.owner_full_name || r.owner_email || UNKNOWN_PERSON) : null,
    created_at: stamp(r.created_at),
  }));
}

export const getBoard = (boardId: number) =>
  fetchrow("SELECT * FROM task_boards WHERE id = $1", [boardId]);

/**
 * "Compliance" and "compliance" are one board. The UNIQUE index holds it;
 * asking first is only so the answer can name the clash.
 */
export async function boardNameTaken(name: string, excludeId: number | null = null): Promise<boolean> {
  return !!(await fetchval(
    `SELECT 1 FROM task_boards
      WHERE LOWER(name) = LOWER($1) AND ($2::int IS NULL OR id <> $2::int)
      LIMIT 1`,
    [name, excludeId],
  ));
}

export async function createBoard(v: {
  name: string;
  description: string | null;
  color: string | null;
  owner_user_id: number | null;
  created_by: number | null;
}): Promise<Row> {
  return (await fetchrow(
    `INSERT INTO task_boards (name, description, color, owner_user_id, sort_order, created_by)
     VALUES ($1, $2, $3, $4::int, (SELECT COUNT(*) FROM task_boards), $5::int)
     RETURNING *`,
    [v.name, v.description, v.color, v.owner_user_id, v.created_by],
  ))!;
}

export const updateBoard = (boardId: number, patch: Row) =>
  updateRow("task_boards", boardId, patch) as Promise<Row>;

/**
 * The order of the rail, written as the whole list rather than the swapped
 * pair (ties would re-sort by name and the move would undo itself). Returns how
 * many rows it ACTUALLY wrote, so a skipped, since-deleted board is reported.
 */
export function reorderBoards(updates: [number, number][]): Promise<number> {
  return tx(async (db) => {
    let written = 0;
    for (const [boardId, sortOrder] of updates) {
      const ok = await fetchval(
        `UPDATE task_boards SET sort_order = $2, updated_at = NOW()
          WHERE id = $1 RETURNING id`,
        [boardId, sortOrder],
        db,
      );
      if (ok) written += 1;
    }
    return written;
  });
}

/** [total, still open] — the numbers the delete refusal is built from. */
export async function boardTaskCounts(boardId: number): Promise<[number, number]> {
  const row = await fetchrow(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status <> 'done') AS open
       FROM tasks WHERE board_id = $1`,
    [boardId],
  );
  return [Number(row!.total), Number(row!.open)];
}

/** The board and everything on it — ON DELETE CASCADE does the whole sweep. */
export async function deleteBoard(boardId: number): Promise<void> {
  await execute("DELETE FROM task_boards WHERE id = $1", [boardId]);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export const getTask = (taskId: number) => fetchrow("SELECT * FROM tasks WHERE id = $1", [taskId]);

export async function getTasks(taskIds: number[]): Promise<Map<number, Row>> {
  if (!taskIds.length) return new Map();
  const rows = await fetch("SELECT * FROM tasks WHERE id = ANY($1::int[])", [intArray(taskIds)]);
  return new Map(rows.map((r) => [r.id as number, r]));
}

export const tasksForBoard = (boardId: number) =>
  fetch(
    `SELECT * FROM tasks WHERE board_id = $1 ORDER BY sort_order, created_at, id`,
    [boardId],
  );

/**
 * One person's work across every LIVE board. `null` means THE WORK NOBODY OWNS
 * YET. Archived boards are excluded; undated work sorts LAST.
 */
export const tasksForPerson = (assigneeUserId: number | null) =>
  fetch(
    `SELECT t.* FROM tasks t
       JOIN task_boards b ON b.id = t.board_id
      WHERE b.is_archived = false
        AND ($1::int IS NULL OR t.assignee_user_id = $1::int)
        AND ($1::int IS NOT NULL OR t.assignee_user_id IS NULL)
      ORDER BY t.due_date ASC NULLS LAST, t.created_at, t.id`,
    [assigneeUserId],
  );

/**
 * Enough of a row to draw a chip and a link, for tasks a fetch NAMES but does
 * not contain. By id, and deliberately not filtered to live boards: a
 * prerequisite on an archived board is still holding the work up.
 */
export async function taskStubs(taskIds: number[]): Promise<Row[]> {
  if (!taskIds.length) return [];
  return fetch(
    "SELECT id, title, status, board_id FROM tasks WHERE id = ANY($1::int[])",
    [intArray(taskIds)],
  );
}

const TASK_COLUMNS = [
  "board_id", "title", "description", "status", "priority",
  "assignee_user_id", "start_date", "due_date", "progress",
  "sort_order", "created_by", "completed_at",
];

export async function createTask(values: Row): Promise<Row> {
  const present = TASK_COLUMNS.filter((c) => c in values);
  const placeholders = present.map((_, i) => `$${i + 1}`).join(", ");
  return (await fetchrow(
    `INSERT INTO tasks (${present.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    present.map((c) => values[c]),
  ))!;
}

export const updateTask = (taskId: number, patch: Row) =>
  updateRow("tasks", taskId, patch) as Promise<Row>;

/**
 * A whole column's order after a drag, in one transaction. Each write is
 * `{id, sort_order, status?, completed_at?, progress?}`, with the completion
 * patch already decided by the route. Returns how many rows were written.
 */
export function reorderTasks(writes: Row[]): Promise<number> {
  return tx(async (db) => {
    let written = 0;
    for (const w of writes) {
      const { id, ...patch } = w;
      const row = await updateRow("tasks", id, patch, { strict: false, db });
      if (row) written += 1;
    }
    return written;
  });
}

/** The task and every child, both directions of every edge — ON DELETE CASCADE. */
export async function deleteTask(taskId: number): Promise<void> {
  await execute("DELETE FROM tasks WHERE id = $1", [taskId]);
}

// ── Completion: the transition into and out of Done ──────────────────────────
// Pure functions of the rows, with no notion of WHO is asking.

/**
 * Entering done stamps `completed_at` and forces 100%; LEAVING done clears the
 * stamp and leaves progress alone. `was` is null for a new row.
 */
export function taskCompletionPatch(was: string | null, next: string | null | undefined): Row {
  if (next == null || next === was) return {};
  if (next === "done") return { completed_at: new Date(), progress: 100 };
  if (was === "done") return { completed_at: null };
  return {};
}

/**
 * The far end of the same rule: a task saved AT 100% is a task that is done.
 *
 * Gated on the TRANSITION to 100, never the value alone, and it stands down
 * when the save explicitly moves the status elsewhere — otherwise a task
 * reopened out of done would snap straight back. It also stands down for a task
 * already done (no re-stamp) and for one in QUALITY CHECK, which already means
 * 100%-and-not-signed-off; completing there would sign the work off on the
 * reviewer's behalf through a control that doesn't look like a sign-off.
 */
export function taskProgressCompletionPatch(
  was: Row | null,
  next: { status?: string | null; progress?: number | null },
): Row {
  const wasStatus = was?.status || "todo";
  const wasProgress = Number(was?.progress || 0);
  const nextStatus = next.status ?? null;
  const nextProgress = next.progress;

  if (nextProgress == null) return {};
  if (Math.trunc(nextProgress) !== 100) return {};
  if (wasProgress === 100) return {};
  if (wasStatus === "done") return {};
  if (wasStatus === "quality_check") return {};
  // A create that NAMED a column other than the default has already said where
  // the task belongs; leave it there.
  if (nextStatus !== null && nextStatus !== wasStatus) return {};

  return { status: "done", completed_at: new Date(), progress: 100 };
}

// ── Dependency edges ─────────────────────────────────────────────────────────

/**
 * Both directions of the graph, read once: [blockedBy, blocks]. `blocks` is
 * sent rather than derived, because "what falls over if I move this" needs the
 * work you CAN'T see from here.
 */
export async function dependencyMap(): Promise<[Map<number, number[]>, Map<number, number[]>]> {
  const rows = await fetch("SELECT task_id, depends_on_task_id FROM task_dependencies");
  const blockedBy = new Map<number, number[]>();
  const blocks = new Map<number, number[]>();
  for (const r of rows) {
    if (!blockedBy.has(r.task_id)) blockedBy.set(r.task_id, []);
    blockedBy.get(r.task_id)!.push(r.depends_on_task_id);
    if (!blocks.has(r.depends_on_task_id)) blocks.set(r.depends_on_task_id, []);
    blocks.get(r.depends_on_task_id)!.push(r.task_id);
  }
  return [blockedBy, blocks];
}

export async function dependencyExists(taskId: number, dependsOn: number): Promise<boolean> {
  return !!(await fetchval(
    `SELECT 1 FROM task_dependencies WHERE task_id = $1 AND depends_on_task_id = $2 LIMIT 1`,
    [taskId, dependsOn],
  ));
}

/**
 * Would "taskId waits on dependsOn" close a loop? Walks forward from the
 * proposed prerequisite; if the waiting task is reachable, it is a cycle. The
 * edges are tens of rows, walked in memory; `seen` means an already-bad row
 * cannot hang this.
 */
export async function dependencyWouldCycle(taskId: number, dependsOn: number): Promise<boolean> {
  if (taskId === dependsOn) return true;
  const [forward] = await dependencyMap();
  const seen = new Set<number>();
  const stack = [dependsOn];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(forward.get(current) ?? []));
  }
  return false;
}

/** ON CONFLICT DO NOTHING: two clicks in the same second are one edge. */
export async function linkDependency(taskId: number, dependsOn: number): Promise<void> {
  await execute(
    `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1, $2)
     ON CONFLICT (task_id, depends_on_task_id) DO NOTHING`,
    [taskId, dependsOn],
  );
}

/** True when an edge actually went — unlinking what is absent is not an event. */
export async function unlinkDependency(taskId: number, dependsOn: number): Promise<boolean> {
  const n = await execute(
    `DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_task_id = $2`,
    [taskId, dependsOn],
  );
  return n > 0;
}

// ── Checklist ────────────────────────────────────────────────────────────────

/** task id → its checklist, in working order. One read for the whole board. */
export async function subtaskMap(): Promise<Map<number, Row[]>> {
  const rows = await fetch(
    `SELECT id, task_id, title, is_done, sort_order FROM task_subtasks
      ORDER BY sort_order, created_at, id`,
  );
  const out = new Map<number, Row[]>();
  for (const r of rows) {
    if (!out.has(r.task_id)) out.set(r.task_id, []);
    out.get(r.task_id)!.push({ id: r.id, title: r.title, is_done: r.is_done, sort_order: r.sort_order });
  }
  return out;
}

export async function nextSubtaskOrder(taskId: number): Promise<number> {
  return Number(await fetchval("SELECT COUNT(*) FROM task_subtasks WHERE task_id = $1", [taskId]));
}

export async function createSubtask(taskId: number, title: string, sortOrder: number): Promise<Row> {
  return (await fetchrow(
    `INSERT INTO task_subtasks (task_id, title, is_done, sort_order)
     VALUES ($1, $2, false, $3)
     RETURNING id, task_id, title, is_done, sort_order`,
    [taskId, title, sortOrder],
  ))!;
}

/** Scoped to the task in the path — the id in the URL is not decoration. */
export const getSubtask = (taskId: number, subtaskId: number) =>
  fetchrow(
    `SELECT id, task_id, title, is_done, sort_order FROM task_subtasks
      WHERE id = $1 AND task_id = $2`,
    [subtaskId, taskId],
  );

export const updateSubtask = (subtaskId: number, patch: Row) =>
  updateRow("task_subtasks", subtaskId, patch, {
    returning: "id, task_id, title, is_done, sort_order",
  }) as Promise<Row>;

export async function deleteSubtask(subtaskId: number): Promise<void> {
  await execute("DELETE FROM task_subtasks WHERE id = $1", [subtaskId]);
}

// ── Discussion ───────────────────────────────────────────────────────────────

/** Oldest first: it reads as a conversation. */
export async function listComments(taskId: number): Promise<Row[]> {
  const rows = await fetch(
    `SELECT c.id, c.task_id, c.body, c.author_user_id, c.created_at, c.edited_at,
            u.full_name AS author_full_name, u.email AS author_email
       FROM task_comments c
       LEFT JOIN users u ON u.id = c.author_user_id
      WHERE c.task_id = $1
      ORDER BY c.created_at, c.id`,
    [taskId],
  );
  return rows.map(shapeComment);
}

export const getComment = (taskId: number, commentId: number) =>
  fetchrow("SELECT * FROM task_comments WHERE id = $1 AND task_id = $2", [commentId, taskId]);

export async function createComment(taskId: number, authorUserId: number, body: string): Promise<Row> {
  const row = await fetchrow(
    `INSERT INTO task_comments (task_id, author_user_id, body)
     VALUES ($1, $2::int, $3)
     RETURNING id, task_id, body, author_user_id, created_at, edited_at,
               (SELECT full_name FROM users WHERE id = $2::int) AS author_full_name,
               (SELECT email     FROM users WHERE id = $2::int) AS author_email`,
    [taskId, authorUserId, body],
  );
  return shapeComment(row!);
}

export async function updateComment(commentId: number, body: string): Promise<Row> {
  const row = await fetchrow(
    `UPDATE task_comments
        SET body = $2, edited_at = NOW(), updated_at = NOW()
      WHERE id = $1
     RETURNING id, task_id, body, author_user_id, created_at, edited_at,
               (SELECT full_name FROM users WHERE id = task_comments.author_user_id) AS author_full_name,
               (SELECT email     FROM users WHERE id = task_comments.author_user_id) AS author_email`,
    [commentId, body],
  );
  return shapeComment(row!);
}

export async function deleteComment(commentId: number): Promise<void> {
  await execute("DELETE FROM task_comments WHERE id = $1", [commentId]);
}

// ── Attachments ──────────────────────────────────────────────────────────────

const shapeFile = (r: Row): Row => ({
  id: r.id,
  task_id: r.task_id,
  name: r.name,
  mime_type: r.mime_type,
  file_size: r.file_size,
  uploaded_by: r.uploaded_by,
  // Resolved at READ time — the comment stance, not the trail's.
  uploader_name: r.uploader_full_name || r.uploader_email || UNKNOWN_PERSON,
  created_at: stamp(r.created_at),
  // `file_key` is deliberately NOT in the response: the only way to the bytes
  // is the download route.
});

/** The paperclips on one task, in the order they arrived. */
export async function listFiles(taskId: number): Promise<Row[]> {
  const rows = await fetch(
    `SELECT f.id, f.task_id, f.name, f.mime_type, f.file_size, f.uploaded_by, f.created_at,
            u.full_name AS uploader_full_name, u.email AS uploader_email
       FROM task_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.task_id = $1
      ORDER BY f.created_at, f.id`,
    [taskId],
  );
  return rows.map(shapeFile);
}

/** Scoped to the task in the path. */
export const getFile = (taskId: number, fileId: number) =>
  fetchrow("SELECT * FROM task_files WHERE id = $1 AND task_id = $2", [fileId, taskId]);

export async function createFile(v: {
  task_id: number;
  name: string;
  file_key: string;
  mime_type: string | null;
  file_size: number;
  uploaded_by: number | null;
}): Promise<Row> {
  const row = await fetchrow(
    `INSERT INTO task_files (task_id, name, file_key, mime_type, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6::int)
     RETURNING id, task_id, name, mime_type, file_size, uploaded_by, created_at,
               (SELECT full_name FROM users WHERE id = $6::int) AS uploader_full_name,
               (SELECT email     FROM users WHERE id = $6::int) AS uploader_email`,
    [v.task_id, v.name, v.file_key, v.mime_type, v.file_size, v.uploaded_by],
  );
  return shapeFile(row!);
}

export async function deleteFile(fileId: number): Promise<void> {
  await execute("DELETE FROM task_files WHERE id = $1", [fileId]);
}

/**
 * Every stored key belonging to these tasks. READ BEFORE THE DELETE, always:
 * the cascade takes the rows, and once they are gone nothing knows the key.
 */
export async function fileKeysForTasks(taskIds: number[]): Promise<string[]> {
  if (!taskIds.length) return [];
  const rows = await fetch(
    "SELECT file_key FROM task_files WHERE task_id = ANY($1::int[])",
    [intArray(taskIds)],
  );
  return rows.map((r) => r.file_key);
}

/** The same, for every task on a board — the board delete's sweep. */
export async function fileKeysForBoard(boardId: number): Promise<string[]> {
  const rows = await fetch(
    `SELECT f.file_key FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE t.board_id = $1`,
    [boardId],
  );
  return rows.map((r) => r.file_key);
}

// ── Activity trail ───────────────────────────────────────────────────────────

/**
 * Newest first, capped. `id` BREAKS THE TIE: one save writes several rows on
 * the same transaction clock, and a sort on created_at alone reshuffles them.
 */
export async function listEvents(taskId: number, limit = 200): Promise<Row[]> {
  const rows = await fetch(
    `SELECT id, actor_user_id, actor_name, action, field, from_value, to_value, created_at
       FROM task_events
      WHERE task_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [taskId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    // The FROZEN name, never a join.
    actor_name: r.actor_name,
    actor_user_id: r.actor_user_id,
    action: r.action,
    field: r.field,
    from: r.from_value,
    to: r.to_value,
    created_at: stamp(r.created_at),
  }));
}

export type EventDraft = { action: string; field?: string; from?: string | null; to?: string | null };

/**
 * Write a batch of trail entries. LOGGING NEVER FAILS THE ACTION IT LOGS —
 * this is an operational record, not a tamper-proof one. Awaited inside the
 * swallow, so a drawer re-reading the trail right after a save sees the change.
 */
export async function recordEvents(
  taskId: number,
  actor: Row | null,
  drafts: EventDraft[],
): Promise<void> {
  if (!drafts.length) return;
  const actorId = actor?.id ?? null;
  const actorName = actorNameOf(actor);
  try {
    const params: unknown[] = [];
    const values = drafts.map((d) => {
      const base = params.length;
      params.push(taskId, actorId, actorName, d.action, d.field ?? null, d.from ?? null, d.to ?? null);
      return `($${base + 1}, $${base + 2}::int, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await execute(
      `INSERT INTO task_events
           (task_id, actor_user_id, actor_name, action, field, from_value, to_value)
       VALUES ${values.join(", ")}`,
      params,
    );
  } catch (err) {
    console.error("task_event_write_failed", { task_id: taskId, error: String(err), note: "the action itself still committed" });
  }
}

// ── People ───────────────────────────────────────────────────────────────────

/**
 * user id → display name, for the owner on every card. DEACTIVATED USERS ARE
 * INCLUDED: a task whose owner has left must still say whose it is.
 */
export async function userNames(): Promise<Map<number, string>> {
  const rows = await fetch("SELECT id, full_name, email FROM users");
  return new Map(rows.map((r) => [r.id as number, (r.full_name || r.email) as string]));
}

/**
 * Who a task may be given to and who a board may be signed off by — one list
 * for both pickers. ACTIVE ONLY, and only roles that can work the board.
 */
export const assignableUsers = () =>
  fetch(
    `SELECT id, email, full_name, role, is_active
       FROM users
      WHERE is_active = true AND role = ANY($1::text[])
      ORDER BY full_name, email`,
    [`{${ASSIGNABLE_ROLES.join(",")}}`],
  );

/** Any status — the caller decides what a deactivated login means. */
export const getUser = (userId: number) =>
  fetchrow("SELECT id, email, full_name, role, is_active FROM users WHERE id = $1", [userId]);

// ── Shaping ──────────────────────────────────────────────────────────────────

/**
 * One comment as the drawer renders it. The author's name is resolved at READ
 * time — a comment is a colleague talking to colleagues, so a rename follows
 * through; an event is authority exercised and is frozen.
 */
export function shapeComment(row: Row): Row {
  return {
    id: row.id,
    task_id: row.task_id,
    body: row.body,
    author_user_id: row.author_user_id,
    author_name: row.author_full_name || row.author_email || UNKNOWN_PERSON,
    created_at: stamp(row.created_at),
    edited_at: stamp(row.edited_at),
  };
}

/**
 * One task as a client consumes it: the row, plus its owner's name, its
 * prerequisites, the work waiting on it, and its checklist — always present,
 * possibly empty. `board` rides along only on the person axis, carrying
 * `owner_user_id` so a drawer opened from My Work knows whether this person may
 * close THIS task.
 */
export function shapeTask(
  task: Row,
  names: Map<number, string>,
  blockedBy: Map<number, number[]>,
  blocks: Map<number, number[]>,
  subtasks: Map<number, Row[]>,
  boards?: Map<number, Row>,
): Row {
  const assigneeId = task.assignee_user_id;
  return {
    id: task.id,
    board_id: task.board_id,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    assignee_user_id: assigneeId,
    assignee_name: assigneeId ? (names.has(assigneeId) ? names.get(assigneeId) : UNKNOWN_PERSON) : null,
    start_date: day(task.start_date),
    due_date: day(task.due_date),
    progress: Number(task.progress || 0),
    sort_order: Number(task.sort_order || 0),
    completed_at: stamp(task.completed_at),
    created_at: stamp(task.created_at),
    blocked_by: blockedBy.get(task.id) ?? [],
    blocks: blocks.get(task.id) ?? [],
    subtasks: subtasks.get(task.id) ?? [],
    board: boards?.get(task.board_id) ?? null,
  };
}

/** The display name for whoever is acting, frozen onto the trail row. */
export function actorNameOf(actor: Row | null): string {
  if (!actor) return "Someone";
  return String(actor.full_name || actor.email || "Someone");
}

/**
 * Diff a task before and after into ONE EVENT PER FIELD that actually moved.
 * Values are LABELS, never keys or ids — rule 2.
 */
export function diffTask(before: Row, after: Row, names: Map<number, string>): EventDraft[] {
  const events: EventDraft[] = [];
  // '' and null are the same absence to a reader.
  const norm = (v: unknown) => (v == null ? "" : v);
  const same = (a: unknown, b: unknown) => norm(a) === norm(b);
  const push = (field: string, frm: unknown, to: unknown) => {
    if (same(frm, to)) return;
    events.push({
      action: "updated",
      field,
      from: frm == null || frm === "" ? null : String(frm),
      to: to == null || to === "" ? null : String(to),
    });
  };
  const who = (id: number | null) => (id ? (names.get(id) ?? "someone since removed") : null);

  push("title", before.title, after.title);
  push("status", TASK_STATUS_LABELS[before.status], TASK_STATUS_LABELS[after.status]);
  push("priority", TASK_PRIORITY_LABELS[before.priority], TASK_PRIORITY_LABELS[after.priority]);
  push("assignee", who(before.assignee_user_id), who(after.assignee_user_id));
  push("start_date", day(before.start_date), day(after.start_date));
  push("due_date", day(before.due_date), day(after.due_date));
  push("progress", `${Number(before.progress || 0)}%`, `${Number(after.progress || 0)}%`);

  // The DESCRIPTION is logged as the FACT that it changed, never from/to: a
  // 4000-character field quoted twice would bury every other line.
  if (!same(before.description, after.description)) {
    events.push({ action: "updated", field: "description" });
  }
  return events;
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * A partial UPDATE built from whatever keys the patch carries, always touching
 * `updated_at`. Column names come only from literal keys in this module and in
 * `../tasks.ts` — never from request keys — so no caller text reaches the SQL.
 * `strict: false` returns null for a since-deleted row, which is how the bulk
 * reorders count what they actually wrote.
 */
async function updateRow(
  table: string,
  rowId: number,
  patch: Row,
  opts: { returning?: string; strict?: boolean; db?: Db } = {},
): Promise<Row | null> {
  const returning = opts.returning ?? "*";
  const strict = opts.strict ?? true;
  const db = opts.db ?? sql;
  const columns = Object.keys(patch);
  let row: Row | null;
  if (!columns.length) {
    row = await fetchrow(`SELECT ${returning} FROM ${table} WHERE id = $1`, [rowId], db);
  } else {
    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    row = await fetchrow(
      `UPDATE ${table} SET ${assignments}, updated_at = NOW() WHERE id = $1 RETURNING ${returning}`,
      [rowId, ...columns.map((c) => patch[c])],
      db,
    );
  }
  if (!row && strict) throw new Error(`${table} ${rowId} is gone`);
  return row;
}
