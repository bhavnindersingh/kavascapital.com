/**
 * The HQ work board — boards, tasks, checklists, discussion, dependencies, trail.
 *
 * Port of nightingale's `app/api/tasks.py`. The data rules live in
 * `_lib/task_service.ts`; this file holds the AUTHORITY rules — who may work
 * the board, and who may sign work off — so the four doors into Done all ask
 * the same question about the person pressing the button.
 *
 * ATTACHMENTS keep the security model and swap the storage: the bytes sit in
 * the private `tasks` bucket, the table stores an opaque KEY rather than a URL,
 * and the only way to a file is the download route below, which re-checks the
 * caller. See `_lib/storage.ts`.
 *
 * Validation that pydantic did is done by hand below and answers in pydantic's
 * shape — 422 with `detail: [{loc, msg, type}]` — which `taskError` on the
 * page already reads.
 */
import { Hono } from "npm:hono@4.6.14";
import { currentUser, type Env, type User } from "./_lib/auth.ts";
import type { Row } from "./_lib/db.ts";
import { HttpError, intParam, intQuery, jsonBody } from "./_lib/http.ts";
import { attachment, KEY_RE, MAX_BYTES, read, remove, removeMany, store, uploadedFile } from "./_lib/storage.ts";
import * as svc from "./_lib/task_service.ts";
import {
  ASSIGNABLE_ROLES,
  diffTask,
  shapeTask,
  TASK_PRIORITIES,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
} from "./_lib/task_service.ts";

export const router = new Hono<Env>();

// Path ids are digits only, so `/boards`, `/reorder` and `/people` can never
// be read as a task id whatever order the routes are registered in.
const ID = "{[0-9]+}";

// ── Who may do what ──────────────────────────────────────────────────────────
//
// Two predicates, and nothing outside this block compares a role to a literal.
// ALLOW-lists, so an unrecognised role is powerless rather than privileged.
// `viewer` is read-only by definition and a board is a thing you work, so it
// is refused; trader, manager and super_admin work the board. Sourced from the
// service's ASSIGNABLE_ROLES: "who may work the board" and "who may be given a
// task" are one rule.
const TASK_ROLES = new Set<string>(ASSIGNABLE_ROLES);
const ADMIN_ROLE = "super_admin";

/** May read the board AND work it: move a card, tick a step, comment. */
const canWorkTasks = (user: Row) => TASK_ROLES.has(user.role);

/** May appoint the person who signs a board's work off. */
const canAdminister = (user: Row) => user.role === ADMIN_ROLE;

// The gate on every route in this file.
router.use("*", async (c, next) => {
  if (!canWorkTasks(currentUser(c))) {
    throw new HttpError(403, "This login can't work the task board.");
  }
  await next();
});

/**
 * WHO MAY SIGN WORK OFF — the one predicate behind every door into Done: the
 * drawer save, a drag into Done (`/reorder`), a task created in Done, and the
 * progress slider reaching the end.
 *
 * A BOARD WITH NO OWNER BEHAVES AS IT ALWAYS HAS (any other default would be
 * an install-wide lockout). Once an owner is named, entering Done is THEIRS
 * ALONE; everyone else's route to finished is Quality Check. THE ADMIN IS NOT
 * EXEMPT — the escape hatch is reassigning the owner, not overriding them.
 */
function maySignOff(board: Row | null, user: User): boolean {
  const owner = board?.owner_user_id;
  return !owner || owner === user.id;
}

/**
 * The sentence a refused sign-off answers with, naming the person who can. The
 * escape hatch is offered only to somebody who can take it.
 */
async function signOffRefusal(board: Row | null, user: User): Promise<string> {
  const ownerId = board?.owner_user_id;
  const owner = ownerId ? await svc.getUser(ownerId) : null;
  const who = owner ? (owner.full_name || owner.email) : "this board's owner";
  const hatch = canAdminister(user) ? " If they are unavailable, change the board owner." : "";
  return `Work on this board is signed off by ${who}. Move it to Quality Check and it will reach them.${hatch}`;
}

/**
 * The auto-complete patch, redirected to Quality Check for somebody who cannot
 * sign off. The `completed_at` stamp is DROPPED with the status (nothing has
 * been accepted yet); the forced 100 stays. An empty patch stays empty.
 */
function reroutedToReview(patch: Row): Row {
  if (patch.status !== "done") return {};
  const out: Row = { status: "quality_check" };
  if ("progress" in patch) out.progress = patch.progress;
  return out;
}

/**
 * The person named must be somebody who can actually WORK THE BOARD, and be
 * active. The board owner is asked the same question; only the sentence
 * differs. Returns an error sentence, or null when the id is fine (or absent).
 */
async function validateTaskPerson(userId: number | null, job: string): Promise<string | null> {
  if (!userId) return null;
  const person = await svc.getUser(userId);
  if (!person) return "That person is not on the user list.";
  const who = person.full_name || person.email;
  if (!person.is_active) return `${who} is deactivated.`;
  if (!canWorkTasks(person)) {
    return `${who} can't work the task board — only a trader, manager or admin can ${job}.`;
  }
  return null;
}

// ── Request shapes ───────────────────────────────────────────────────────────
//
// ABSENT and NULL differ on every patch below, and the distinction is
// load-bearing: the board bar sends only what was touched, so renaming a board
// must not blank its owner, and "No owner" has to be able to remove one.

type Loc = (string | number)[];

function invalid(loc: Loc, msg: string): never {
  throw new HttpError(422, [{ type: "value_error", loc: ["body", ...loc], msg }]);
}

const has = (o: Row, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A string field. `undefined` = absent; null only when not required. */
function str(
  o: Row,
  key: string,
  opts: { required?: boolean; min?: number; max?: number; loc?: Loc } = {},
): string | null | undefined {
  const loc = [...(opts.loc ?? []), key];
  if (!has(o, key)) {
    if (opts.required) invalid(loc, "Field required");
    return undefined;
  }
  const v = o[key];
  if (v === null) {
    if (opts.required) invalid(loc, "Input should be a valid string");
    return null;
  }
  if (typeof v !== "string") invalid(loc, "Input should be a valid string");
  if (opts.min !== undefined && v.length < opts.min) {
    invalid(loc, `String should have at least ${opts.min} character${opts.min === 1 ? "" : "s"}`);
  }
  if (opts.max !== undefined && v.length > opts.max) {
    invalid(loc, `String should have at most ${opts.max} characters`);
  }
  return v;
}

/** An integer field, accepting what pydantic's lax mode does ("5", 5.0). */
function int(
  o: Row,
  key: string,
  opts: { required?: boolean; ge?: number; loc?: Loc } = {},
): number | null | undefined {
  const loc = [...(opts.loc ?? []), key];
  if (!has(o, key)) {
    if (opts.required) invalid(loc, "Field required");
    return undefined;
  }
  let v = o[key];
  if (v === null) {
    if (opts.required) invalid(loc, "Input should be a valid integer");
    return null;
  }
  if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) v = Number(v);
  if (typeof v !== "number" || !Number.isInteger(v)) invalid(loc, "Input should be a valid integer");
  if (opts.ge !== undefined && v < opts.ge) invalid(loc, `Input should be greater than or equal to ${opts.ge}`);
  return v;
}

function bool(o: Row, key: string): boolean | null | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return v === 1;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "1", "yes", "on", "t", "y"].includes(s)) return true;
    if (["false", "0", "no", "off", "f", "n"].includes(s)) return false;
  }
  invalid([key], "Input should be a valid boolean");
}

/**
 * '' from an emptied date input means "no date", not an invalid one — so it
 * normalises to null rather than reaching the column as an empty string.
 */
function dayField(o: Row, key: string): string | null | undefined {
  const v = str(o, key);
  if (v == null) return v;
  const clean = v.trim();
  if (!clean) return null;
  const ok = /^\d{4}-\d{1,2}-\d{1,2}$/.test(clean) && (() => {
    const [y, m, d] = clean.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  })();
  if (!ok) invalid([key], "Dates must be YYYY-MM-DD");
  // Normalised to zero-padded ISO so the DATE column and the ordering check agree.
  const [y, m, d] = clean.split("-");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function statusField(o: Row, key = "status", loc: Loc = []): string | null | undefined {
  const v = str(o, key, { loc });
  if (v != null && !(TASK_STATUSES as readonly string[]).includes(v)) {
    invalid([...loc, key], `Status must be one of: ${TASK_STATUSES.join(", ")}`);
  }
  return v;
}

function priorityField(o: Row): string | null | undefined {
  const v = str(o, "priority");
  if (v != null && !(TASK_PRIORITIES as readonly string[]).includes(v)) {
    invalid(["priority"], `Priority must be one of: ${TASK_PRIORITIES.join(", ")}`);
  }
  return v;
}

/** The `updates` list of a reorder body, min length 1. */
function updatesList(body: Row): Row[] {
  if (!has(body, "updates")) invalid(["updates"], "Field required");
  const list = body.updates;
  if (!Array.isArray(list)) invalid(["updates"], "Input should be a valid list");
  if (list.length < 1) invalid(["updates"], "List should have at least 1 item after validation, not 0");
  return list.map((entry: unknown, i: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid(["updates", i], "Input should be a valid dictionary or object to extract fields from");
    }
    return entry as Row;
  });
}

const textOrNone = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  return v.trim() || null;
};

const collapse = (v: string | null | undefined) => (v ?? "").split(/\s+/).filter(Boolean).join(" ");

const clampProgress = (v: number | null | undefined): number => {
  const n = v == null || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v));
  return Math.max(0, Math.min(100, n));
};

/**
 * Held by a CHECK constraint too. Asked here so the answer is a sentence, and
 * against the MERGED values on a partial update.
 */
const datesOrdered = (start: string | null, due: string | null) => !start || !due || due >= start;

// ── Shared read plumbing ─────────────────────────────────────────────────────

/**
 * Every row `shaped` points at — in either direction — that `shaped` does not
 * itself contain. Both axes need it: person mode spans boards, and board mode
 * has the same hole from cross-board links made in My Work.
 */
async function foreignTasks(shaped: Row[]): Promise<Row[]> {
  const have = new Set(shaped.map((t) => t.id));
  const missing = new Set<number>();
  for (const t of shaped) {
    for (const i of t.blocked_by) if (!have.has(i)) missing.add(i);
    for (const i of t.blocks) if (!have.has(i)) missing.add(i);
  }
  return svc.taskStubs([...missing].sort((a, b) => a - b));
}

const boardOut = (board: Row): Row => ({
  id: board.id,
  name: board.name,
  description: board.description ?? null,
  color: board.color ?? null,
  is_archived: board.is_archived ?? false,
  sort_order: board.sort_order ?? 0,
  owner_user_id: board.owner_user_id ?? null,
});

// ═══ PEOPLE & BOARDS ═════════════════════════════════════════════════════════

/**
 * Who a task may be given to, and who a board may be signed off by. Its own
 * route rather than `/platform/users`, which is admin-only.
 */
router.get("/people", async (c) => c.json({ people: await svc.assignableUsers() }));

/** The rail: every board, live first, each with its count of open work. */
router.get("/boards", async (c) => c.json({ boards: await svc.listBoards() }));

/** A board is a PROJECT, not a desk. Flat, and archived rather than deleted. */
router.post("/boards", async (c) => {
  const user = currentUser(c);
  const body = await jsonBody(c);
  const rawName = str(body, "name", { required: true, min: 1, max: 120 });
  const description = str(body, "description", { max: 2000 });
  const color = str(body, "color", { max: 20 });
  const ownerUserId = int(body, "owner_user_id");

  const name = collapse(rawName);
  if (!name) throw new HttpError(400, "Give the board a name");
  if (await svc.boardNameTaken(name)) {
    throw new HttpError(409, `A board called "${name}" already exists.`);
  }

  // Admin-only HERE too, or the rule is bypassed at creation: name yourself
  // owner and the appointment never went through the door that guards it.
  const ownerId = ownerUserId || null;
  if (ownerId && !canAdminister(user)) {
    throw new HttpError(403, "Only an admin can name who signs off a board's work.");
  }
  const bad = await validateTaskPerson(ownerId, "sign work off");
  if (bad) throw new HttpError(400, bad);

  const board = await svc.createBoard({
    name,
    description: textOrNone(description),
    color: textOrNone(color),
    owner_user_id: ownerId,
    created_by: user.id,
  });
  return c.json({ board: { ...boardOut(board), open_count: 0 } }, 201);
});

/**
 * The order of the rail, as the whole live list. Archived boards are not
 * refused, merely never sent. Not on any trail.
 */
router.post("/boards/reorder", async (c) => {
  const body = await jsonBody(c);
  const updates = updatesList(body).map((u, i): [number, number] => [
    int(u, "id", { required: true, loc: ["updates", i] })!,
    int(u, "sort_order", { required: true, ge: 0, loc: ["updates", i] })!,
  ]);
  const written = await svc.reorderBoards(updates);
  if (written < updates.length) {
    throw new HttpError(
      409,
      written === 0
        ? "That move was not saved — those boards are gone."
        : "Only part of that move was saved — the rail has been reloaded.",
    );
  }
  return c.json({ updated: written });
});

/** Rename, recolour, describe, archive or restore — and, admin only, appoint the owner. */
router.post(`/boards/:board_id${ID}`, async (c) => {
  const user = currentUser(c);
  const boardId = intParam(c, "board_id");
  const body = await jsonBody(c);
  const name = str(body, "name", { max: 120 });
  const description = str(body, "description", { max: 2000 });
  const color = str(body, "color", { max: 20 });
  const isArchived = bool(body, "is_archived");
  const ownerUserId = int(body, "owner_user_id");

  const board = await svc.getBoard(boardId);
  if (!board) throw new HttpError(404, "That board is gone.");

  const patch: Row = {};
  if (name !== undefined) {
    const clean = collapse(name);
    if (!clean) throw new HttpError(400, "Give the board a name");
    if (await svc.boardNameTaken(clean, boardId)) {
      throw new HttpError(409, `A board called "${clean}" already exists.`);
    }
    patch.name = clean;
  }
  if (description !== undefined) patch.description = textOrNone(description);
  if (color !== undefined) patch.color = textOrNone(color);
  if (isArchived !== undefined) patch.is_archived = !!isArchived;

  if (ownerUserId !== undefined) {
    // APPOINTING THE OWNER IS ADMIN. Upkeep stays every working desk's; naming
    // who signs work off is AUTHORITY — and without this anybody refused at
    // Done could appoint themselves owner, finish, and put the board back.
    if (!canAdminister(user)) {
      throw new HttpError(
        403,
        "Only an admin can change who signs off this board's work. Ask one to name a new owner.",
      );
    }
    const ownerId = ownerUserId || null;
    const bad = await validateTaskPerson(ownerId, "sign work off");
    if (bad) throw new HttpError(400, bad);
    // Clearing one is a real state: a board can be between owners.
    patch.owner_user_id = ownerId;
  }

  if (!Object.keys(patch).length) return c.json({ board: boardOut(board) });
  return c.json({ board: boardOut(await svc.updateBoard(boardId, patch)) });
});

/**
 * The board and everything on it. Only once every task on it is DONE — refused
 * HERE, because no number the client holds is trustworthy for something
 * irreversible.
 */
router.delete(`/boards/:board_id${ID}`, async (c) => {
  const boardId = intParam(c, "board_id");
  const board = await svc.getBoard(boardId);
  if (!board) throw new HttpError(404, "That board is gone.");

  const [total, openCount] = await svc.boardTaskCounts(boardId);
  if (openCount) {
    throw new HttpError(
      409,
      `This board still has ${openCount} unfinished task${openCount === 1 ? "" : "s"}. ` +
        "Finish them, or archive the board instead — archiving keeps everything and can be undone.",
    );
  }

  // Keys before the delete (the cascade takes the rows); rows first, bytes after.
  const keys = await svc.fileKeysForBoard(boardId);
  await svc.deleteBoard(boardId);
  await removeMany("tasks", keys);
  return c.json({ deleted: true, tasks_deleted: total });
});

// ═══ TASKS ═══════════════════════════════════════════════════════════════════

/**
 * The same rows, read along either axis:
 *   ?board_id=…             one board's tasks (kanban / timeline / list)
 *   ?assignee_user_id=…     one person's tasks across every LIVE board
 *   ?assignee_user_id=none  …and the work nobody owns yet
 * Both also return `foreign_tasks` — see `foreignTasks`.
 */
router.get("/", async (c) => {
  const boardId = intQuery(c, "board_id");
  const assignee = c.req.query("assignee_user_id");

  const names = await svc.userNames();
  const [blockedBy, blocks] = await svc.dependencyMap();
  const subs = await svc.subtaskMap();

  if (boardId !== undefined) {
    const rows = await svc.tasksForBoard(boardId);
    const shaped = rows.map((t) => shapeTask(t, names, blockedBy, blocks, subs));
    return c.json({ tasks: shaped, foreign_tasks: await foreignTasks(shaped) });
  }

  if (assignee === undefined) {
    throw new HttpError(400, "Ask for a board_id or an assignee_user_id.");
  }

  let wanted: number | null;
  if (assignee === "none") {
    wanted = null;
  } else if (/^\s*[+-]?\d+\s*$/.test(assignee)) {
    wanted = Number(assignee);
  } else {
    throw new HttpError(400, "assignee_user_id must be a user id, or 'none'.");
  }

  const boards = new Map<number, Row>();
  for (const b of await svc.listBoards()) {
    if (b.is_archived) continue;
    // owner_user_id rides along because My Work SPANS BOARDS, each with its own
    // owner: a drawer opened from here has to know who may close THIS task.
    boards.set(b.id, { id: b.id, name: b.name, color: b.color, owner_user_id: b.owner_user_id });
  }
  const rows = await svc.tasksForPerson(wanted);
  const shaped = rows.map((t) => shapeTask(t, names, blockedBy, blocks, subs, boards));
  return c.json({ tasks: shaped, foreign_tasks: await foreignTasks(shaped) });
});

/** Add a task to a board. */
router.post("/", async (c) => {
  const user = currentUser(c);
  const body = await jsonBody(c);
  const boardIdIn = int(body, "board_id", { required: true })!;
  const title = str(body, "title", { required: true, min: 1, max: 200 })!;
  const description = str(body, "description", { max: 4000 });
  const statusIn = statusField(body);
  const priority = priorityField(body);
  const assigneeIn = int(body, "assignee_user_id");
  const start = dayField(body, "start_date") ?? null;
  const due = dayField(body, "due_date") ?? null;
  const progressIn = int(body, "progress");
  const sortOrder = int(body, "sort_order");

  const board = await svc.getBoard(boardIdIn);
  if (!board) throw new HttpError(404, "That board is gone.");

  if (!datesOrdered(start, due)) {
    throw new HttpError(400, "The due date cannot be before the start date.");
  }

  const assignee = assigneeIn || null;
  const bad = await validateTaskPerson(assignee, "own a task");
  if (bad) throw new HttpError(400, bad);

  const taskStatus = statusIn || "todo";
  const progress = clampProgress(progressIn);

  // THE FOURTH DOOR. A task created straight into Done, or at 100 and completed
  // by the rule below, never passes a status control — so ask here too.
  const mayFinish = maySignOff(board, user);
  if (taskStatus === "done" && !mayFinish) {
    throw new HttpError(403, await signOffRefusal(board, user));
  }

  const auto = svc.taskProgressCompletionPatch(null, { status: statusIn ?? null, progress });
  const completion = {
    ...svc.taskCompletionPatch(null, taskStatus),
    // REDIRECTED rather than refused: a card created at 100 on a board with an
    // owner means "finished and ready for review".
    ...(mayFinish ? auto : reroutedToReview(auto)),
  };

  const created = await svc.createTask({
    board_id: boardIdIn,
    title: title.trim(),
    description: textOrNone(description),
    status: taskStatus,
    priority: priority || "medium",
    assignee_user_id: assignee,
    start_date: start,
    due_date: due,
    progress,
    sort_order: sortOrder || 0,
    created_by: user.id,
    // Last, so a completion decided above wins over the status and progress.
    ...completion,
  });

  // The trail opens with the creation — the one fact no later diff can supply.
  await svc.recordEvents(created.id, user, [{ action: "created" }]);

  const names = await svc.userNames();
  const [blockedBy, blocks] = await svc.dependencyMap();
  return c.json({ task: shapeTask(created, names, blockedBy, blocks, new Map()) }, 201);
});

/**
 * Persist a whole column's order after a drag. It is THE PRIMARY WAY A TASK
 * GETS COMPLETED, so the completion stamp and the sign-off fire here too; and
 * it answers with how many rows it ACTUALLY wrote.
 */
router.post("/reorder", async (c) => {
  const user = currentUser(c);
  const body = await jsonBody(c);
  const updates = updatesList(body).map((u, i) => ({
    id: int(u, "id", { required: true, loc: ["updates", i] })!,
    status: statusField(u, "status", ["updates", i]) ?? null,
    sort_order: int(u, "sort_order", { required: true, loc: ["updates", i] })!,
  }));
  const byId = await svc.getTasks(updates.map((u) => u.id));

  // ── THE SIGN-OFF, at the door tasks are actually completed through ────────
  const finishing = updates.filter(
    (u) => u.status === "done" && byId.has(u.id) && byId.get(u.id)!.status !== "done",
  );
  const refused = new Set<number>();
  let refusal: string | null = null;
  for (const u of finishing) {
    const board = await svc.getBoard(byId.get(u.id)!.board_id);
    // FAIL CLOSED when the board could not be read: here a null means a lookup
    // that should have succeeded didn't.
    if (!board || !maySignOff(board, user)) {
      refused.add(u.id);
      if (refusal === null) {
        refusal = board
          ? await signOffRefusal(board, user)
          : "Couldn't read that board's settings just now — try that again.";
      }
    }
  }

  const writes: Row[] = [];
  // READ BEFORE THE WRITE: labels are taken while "before" still means before.
  const transitions: { id: number; from: string; to: string }[] = [];
  for (const u of updates) {
    const before = byId.get(u.id);
    if (!before || refused.has(u.id)) continue;
    const write: Row = { id: u.id, sort_order: u.sort_order };
    if (u.status !== null) write.status = u.status;
    Object.assign(write, svc.taskCompletionPatch(before.status, u.status));
    writes.push(write);
    // Only the STATUS is logged, never sort_order: a drag renumbers every card
    // below the one that moved.
    if (u.status !== null && before.status !== u.status) {
      transitions.push({
        id: u.id,
        from: TASK_STATUS_LABELS[before.status],
        to: TASK_STATUS_LABELS[u.status],
      });
    }
  }

  const written = writes.length ? await svc.reorderTasks(writes) : 0;

  for (const t of transitions) {
    await svc.recordEvents(t.id, user, [
      { action: "updated", field: "status", from: t.from, to: t.to },
    ]);
  }

  if (written < updates.length) {
    // A refusal says WHY in the sign-off's own words, not "the tasks are gone".
    throw new HttpError(409, {
      message: refusal ??
        (written === 0
          ? "That move was not saved — the tasks are no longer on this board."
          : "Only part of that move was saved — the board has been reloaded."),
      updated: written,
    });
  }
  return c.json({ updated: written });
});

/**
 * A partial patch, so a drawer's full edit and a timeline's drag-to-reschedule
 * share one path. Only the keys present are written.
 */
router.post(`/:task_id${ID}`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const body = await jsonBody(c);
  const title = str(body, "title", { max: 200 });
  const description = str(body, "description", { max: 4000 });
  const statusIn = statusField(body);
  const priority = priorityField(body);
  const assigneeIn = int(body, "assignee_user_id");
  const startIn = dayField(body, "start_date");
  const dueIn = dayField(body, "due_date");
  const progressIn = int(body, "progress");
  const sortOrder = int(body, "sort_order");

  const task = await svc.getTask(taskId);
  if (!task) throw new HttpError(404, "That task is gone.");

  const patch: Row = {};
  if (title !== undefined) {
    const clean = (title ?? "").trim();
    if (!clean) throw new HttpError(400, "Give the task a title");
    patch.title = clean;
  }
  if (description !== undefined) patch.description = textOrNone(description);
  if (priority != null) patch.priority = priority;
  if (progressIn !== undefined) patch.progress = clampProgress(progressIn);
  if (sortOrder !== undefined) patch.sort_order = sortOrder || 0;

  if (assigneeIn !== undefined) {
    const assignee = assigneeIn || null;
    const bad = await validateTaskPerson(assignee, "own a task");
    if (bad) throw new HttpError(400, bad);
    patch.assignee_user_id = assignee;
  }

  // The date check runs against the MERGED values, not the submitted ones.
  const nextStart = startIn !== undefined ? startIn : (task.start_date ?? null);
  const nextDue = dueIn !== undefined ? dueIn : (task.due_date ?? null);
  if (!datesOrdered(nextStart, nextDue)) {
    throw new HttpError(400, "The due date cannot be before the start date.");
  }
  if (startIn !== undefined) patch.start_date = nextStart;
  if (dueIn !== undefined) patch.due_date = nextDue;

  const newStatus = statusIn ?? null;
  const submittedProgress = progressIn !== undefined ? clampProgress(progressIn) : null;

  // ── THE SIGN-OFF ─────────────────────────────────────────────────────────
  // Asked before any status is written, of the BOARD this task is on.
  const needsBoard = newStatus === "done" || submittedProgress !== null;
  const board = needsBoard ? await svc.getBoard(task.board_id) : null;
  if (needsBoard && !board) {
    // FAIL CLOSED: pressing again is recoverable; a silent unsigned close is not.
    throw new HttpError(409, "Couldn't read this board's settings just now — try that again.");
  }
  const mayFinish = maySignOff(board, user);

  if (newStatus === "done" && task.status !== "done" && !mayFinish) {
    throw new HttpError(403, await signOffRefusal(board, user));
  }

  if (newStatus !== null) {
    patch.status = newStatus;
    // Entering done stamps and forces 100%; leaving it clears the stamp.
    // After the explicit progress, so a move to Done wins over the slider.
    Object.assign(patch, svc.taskCompletionPatch(task.status, newStatus));
  }

  // The far end: a slider pushed to 100 completes the task by itself — judged
  // on the SUBMITTED progress, not the 100 the block above may have written.
  const auto = svc.taskProgressCompletionPatch(task, { status: newStatus, progress: submittedProgress });
  // THE SLIDER IS THE FOURTH DOOR, RESHAPED rather than refused: for somebody
  // who cannot sign off, "I've finished my part" lands in Quality Check.
  Object.assign(patch, mayFinish ? auto : reroutedToReview(auto));

  const updated = Object.keys(patch).length ? await svc.updateTask(taskId, patch) : task;

  const names = await svc.userNames();
  const [blockedBy, blocks] = await svc.dependencyMap();
  const subs = await svc.subtaskMap();

  // Diffed against what was WRITTEN, so the completion rules' own changes show.
  await svc.recordEvents(taskId, user, diffTask(task, updated, names));

  return c.json({ task: shapeTask(updated, names, blockedBy, blocks, subs) });
});

/**
 * The task and everything hanging off it. THE KEYS ARE READ BEFORE THE DELETE;
 * rows first, bytes after.
 */
router.delete(`/:task_id${ID}`, async (c) => {
  const taskId = intParam(c, "task_id");
  const task = await svc.getTask(taskId);
  if (!task) throw new HttpError(404, "That task is gone.");
  const keys = await svc.fileKeysForTasks([taskId]);
  await svc.deleteTask(taskId);
  await removeMany("tasks", keys);
  return c.json({ deleted: true });
});

// ═══ CHECKLIST ═══════════════════════════════════════════════════════════════
// These write IMMEDIATELY rather than queueing behind a Save button.

/** Add a step to the end of the list. */
router.post(`/:task_id${ID}/subtasks`, async (c) => {
  const taskId = intParam(c, "task_id");
  const body = await jsonBody(c);
  const rawTitle = str(body, "title", { required: true, min: 1, max: 200 })!;
  const sortOrderIn = int(body, "sort_order");

  const title = rawTitle.trim();
  if (!title) throw new HttpError(400, "Give the step a name");
  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");

  // A stale drawer could send a used number; fall back to the end of what is stored.
  const sortOrder = sortOrderIn != null ? sortOrderIn : await svc.nextSubtaskOrder(taskId);
  return c.json({ subtask: await svc.createSubtask(taskId, title, sortOrder) }, 201);
});

/** Tick, untick or rename a step, scoped to the task in the path. */
router.post(`/:task_id${ID}/subtasks/:subtask_id${ID}`, async (c) => {
  const taskId = intParam(c, "task_id");
  const subtaskId = intParam(c, "subtask_id");
  const body = await jsonBody(c);
  const title = str(body, "title", { max: 200 });
  const isDone = bool(body, "is_done");
  const sortOrder = int(body, "sort_order");

  const step = await svc.getSubtask(taskId, subtaskId);
  if (!step) throw new HttpError(404, "That step is gone.");

  const patch: Row = {};
  if (isDone !== undefined) patch.is_done = !!isDone;
  if (title !== undefined) {
    const clean = (title ?? "").trim();
    if (!clean) throw new HttpError(400, "Give the step a name");
    patch.title = clean;
  }
  if (sortOrder !== undefined) patch.sort_order = sortOrder || 0;

  if (!Object.keys(patch).length) return c.json({ subtask: step });
  return c.json({ subtask: await svc.updateSubtask(subtaskId, patch) });
});

router.delete(`/:task_id${ID}/subtasks/:subtask_id${ID}`, async (c) => {
  const taskId = intParam(c, "task_id");
  const subtaskId = intParam(c, "subtask_id");
  const step = await svc.getSubtask(taskId, subtaskId);
  if (!step) throw new HttpError(404, "That step is gone.");
  await svc.deleteSubtask(subtaskId);
  return c.json({ deleted: true });
});

// ═══ DEPENDENCIES ════════════════════════════════════════════════════════════
// "This task waits on that one." Edges only, written immediately.

/** Link. Cycles and self-reference refused. */
router.post(`/:task_id${ID}/dependencies`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const body = await jsonBody(c);
  const dependsOn = int(body, "depends_on_task_id", { required: true })!;

  if (taskId === dependsOn) throw new HttpError(400, "A task cannot wait on itself.");

  const task = await svc.getTask(taskId);
  const prerequisite = await svc.getTask(dependsOn);
  if (!task || !prerequisite) throw new HttpError(404, "One of those tasks is gone.");

  // Already linked: the user's intent already holds — a success, not a duplicate.
  if (await svc.dependencyExists(taskId, dependsOn)) return c.json({ linked: true }, 201);

  if (await svc.dependencyWouldCycle(taskId, dependsOn)) {
    throw new HttpError(400, "That would create a circular dependency.");
  }

  await svc.linkDependency(taskId, dependsOn);

  // BOTH ends are logged, each in its own words. Titles, never ids.
  await svc.recordEvents(taskId, user, [
    { action: "linked", field: "waiting_on", to: prerequisite.title },
  ]);
  await svc.recordEvents(dependsOn, user, [
    { action: "linked", field: "blocks", to: task.title },
  ]);
  return c.json({ linked: true }, 201);
});

/**
 * Unlink. Removing what is not there is a success, but not an event.
 */
router.delete(`/:task_id${ID}/dependencies`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const body = await jsonBody(c);
  const dependsOn = int(body, "depends_on_task_id", { required: true })!;

  const removed = await svc.unlinkDependency(taskId, dependsOn);
  if (removed) {
    const task = await svc.getTask(taskId);
    const prerequisite = await svc.getTask(dependsOn);
    if (prerequisite) {
      await svc.recordEvents(taskId, user, [
        { action: "unlinked", field: "waiting_on", to: prerequisite.title },
      ]);
    }
    if (task) {
      await svc.recordEvents(dependsOn, user, [
        { action: "unlinked", field: "blocks", to: task.title },
      ]);
    }
  }
  return c.json({ unlinked: true });
});

// ═══ DISCUSSION ══════════════════════════════════════════════════════════════

/** A comment body: 1–4000 characters, and not only whitespace. */
function commentBody(body: Row): string {
  const v = str(body, "body", { required: true, min: 1, max: 4000 })!;
  const clean = v.trim();
  if (!clean) invalid(["body"], "Write something first.");
  return clean;
}

/** Oldest first: it reads as a conversation. */
router.get(`/:task_id${ID}/comments`, async (c) => {
  const taskId = intParam(c, "task_id");
  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");
  return c.json({ comments: await svc.listComments(taskId) });
});

/**
 * Say something. NOT logged to the trail: a comment is already attributed and
 * timestamped where people read it.
 */
router.post(`/:task_id${ID}/comments`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const text = commentBody(await jsonBody(c));
  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");
  return c.json({ comment: await svc.createComment(taskId, user.id, text) }, 201);
});

/**
 * Edit what you said. ONLY THE AUTHOR, deliberately not an admin: rewritable
 * comments would make every comment on the board unquotable.
 */
router.post(`/:task_id${ID}/comments/:comment_id${ID}`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const commentId = intParam(c, "comment_id");
  const text = commentBody(await jsonBody(c));
  const comment = await svc.getComment(taskId, commentId);
  if (!comment) throw new HttpError(404, "That comment is gone.");
  if (comment.author_user_id !== user.id) {
    throw new HttpError(403, "You can only edit your own comments.");
  }
  return c.json({ comment: await svc.updateComment(commentId, text) });
});

/**
 * The author, or an admin clearing something that should not be there —
 * removing words does not put words in anybody's mouth.
 */
router.delete(`/:task_id${ID}/comments/:comment_id${ID}`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const commentId = intParam(c, "comment_id");
  const comment = await svc.getComment(taskId, commentId);
  if (!comment) throw new HttpError(404, "That comment is gone.");
  if (comment.author_user_id !== user.id && !canAdminister(user)) {
    throw new HttpError(403, "You can only delete your own comments.");
  }
  await svc.deleteComment(commentId);
  return c.json({ deleted: true });
});

// ═══ ATTACHMENTS ═════════════════════════════════════════════════════════════
// The bytes live in the private `tasks` bucket and are NEVER served by URL —
// the download route below is the only way out, and it re-checks the caller.

router.get(`/:task_id${ID}/files`, async (c) => {
  const taskId = intParam(c, "task_id");
  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");
  return c.json({ files: await svc.listFiles(taskId) });
});

/**
 * Attach a file. THE NAME IS DATA, NOT A PATH: it is stored for display only,
 * reduced to its basename so it cannot even be displayed as a path. The stored
 * key is one this server issues.
 */
router.post(`/:task_id${ID}/files`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    invalid(["file"], "Field required");
  }
  const file = await uploadedFile(form);

  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");

  const rawName = (file.name ?? "").split(/[\\/]/).pop()!.trim();
  if (!rawName) throw new HttpError(400, "That file has no name.");
  const name = rawName.slice(0, 255);

  // Over the ceiling is a 413, as it was when the size was counted while writing.
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `That file is bigger than the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.`);
  }
  // Type is checked on the name the row will carry, extension first.
  const named = file.name === name ? file : new File([file], name, { type: file.type });
  const stored = await store("tasks", named);

  let row: Row;
  try {
    row = await svc.createFile({
      task_id: taskId,
      name,
      file_key: stored.key,
      mime_type: stored.mime,
      file_size: stored.size,
      uploaded_by: user.id,
    });
  } catch (err) {
    // If the row did not land, the bytes are unreachable by definition.
    await remove("tasks", stored.key);
    throw err;
  }

  // On the trail: attaching a file is something somebody DID.
  await svc.recordEvents(taskId, user, [{ action: "updated", field: "attachment", to: name }]);
  return c.json({ file: row }, 201);
});

/**
 * The bytes — the ONLY route to them. Always an attachment, never inline, and
 * the stored mime type is not echoed back.
 */
router.get(`/:task_id${ID}/files/:file_id${ID}/download`, async (c) => {
  const taskId = intParam(c, "task_id");
  const fileId = intParam(c, "file_id");
  const row = await svc.getFile(taskId, fileId);
  if (!row) throw new HttpError(404, "That file is gone.");

  if (!KEY_RE.test(row.file_key ?? "")) {
    console.error("task_file_bad_key", { file_id: fileId, key: row.file_key });
    throw new HttpError(404, "That file is gone.");
  }
  const blob = await read("tasks", row.file_key);
  if (!blob) {
    // The row outlived its bytes — recoverable: somebody can re-upload.
    throw new HttpError(
      404,
      "That file is no longer stored. Ask whoever attached it to add it again.",
    );
  }
  return attachment(blob, row.name);
});

/** Remove an attachment. The uploader, or an admin. */
router.delete(`/:task_id${ID}/files/:file_id${ID}`, async (c) => {
  const user = currentUser(c);
  const taskId = intParam(c, "task_id");
  const fileId = intParam(c, "file_id");
  const row = await svc.getFile(taskId, fileId);
  if (!row) throw new HttpError(404, "That file is gone.");
  if (row.uploaded_by !== user.id && !canAdminister(user)) {
    throw new HttpError(403, "You can only remove files you attached.");
  }

  await svc.deleteFile(fileId);
  await remove("tasks", row.file_key);
  await svc.recordEvents(taskId, user, [{ action: "updated", field: "attachment", from: row.name }]);
  return c.json({ deleted: true });
});

// ═══ ACTIVITY TRAIL ══════════════════════════════════════════════════════════

/**
 * Who changed what on this task, newest first. READ-ONLY: there is no write
 * route for these rows anywhere — a log its own subject can edit proves nothing.
 */
router.get(`/:task_id${ID}/events`, async (c) => {
  const taskId = intParam(c, "task_id");
  if (!(await svc.getTask(taskId))) throw new HttpError(404, "That task is gone.");
  return c.json({ events: await svc.listEvents(taskId) });
});
