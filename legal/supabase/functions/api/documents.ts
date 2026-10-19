/**
 * Documents cabinet — the two partners only.
 *
 * Port of nightingale's `api/documents.py` + `services/document_service.py`.
 * Nested folders of company paperwork (legal, work, tax). Same gate as Account
 * Management: the login email must be in ACCOUNTS_ALLOWED_EMAILS, whatever the
 * role. Files come back only through the download route, always as an
 * octet-stream attachment.
 *
 * Folders nest via `parent_id` (NULL = top level), at most MAX_DEPTH levels.
 * Postgres holds the no-self-parent CHECK, the per-parent case-insensitive
 * name uniqueness and the cascades; the cycle/depth walk is the one rule that
 * lives here. `file_key` never leaves this module — the client has no use for
 * a key it cannot fetch.
 */
import { Hono } from "npm:hono@4.6.14";
import { currentUser, requirePartner, type Env } from "./_lib/auth.ts";
import {
  execute, fetch, fetchrow, fetchval, pgCode,
  FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION, type Row,
} from "./_lib/db.ts";
import { HttpError, intParam, intQuery, jsonBody } from "./_lib/http.ts";
import { MAX_BYTES, attachment, read, remove, removeMany, store, uploadedFile } from "./_lib/storage.ts";

export const router = new Hono<Env>();
router.use("*", requirePartner);

const MAX_DEPTH = 5;

const DOC_COLUMNS = `
    d.id, d.folder_id, d.name, d.description, d.file_key, d.mime_type, d.file_size,
    d.uploaded_by, u.full_name AS uploaded_by_name, d.created_at, d.updated_at
`;

/** A sibling with that name already exists (shown verbatim, 409). */
class FolderConflict extends HttpError {
  constructor(detail: string) { super(409, detail); }
}

/** A create/move would break the tree (shown verbatim, 400). */
class FolderTreeError extends HttpError {
  constructor(detail: string) { super(400, detail); }
}

/** The stored key never leaves; its extension does, so the page can name the download. */
function shapeDoc(r: Row): Row {
  const { file_key, ...d } = r;
  const key: string = file_key ?? "";
  return { ...d, ext: key.includes(".") ? key.split(".").pop()!.toLowerCase() : "" };
}

/** Trim and collapse whitespace, so "Tax  Returns " is one name. */
function cleanName(value: unknown, what: string): string {
  const name = (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
  if (!name) throw new HttpError(400, `Give the ${what} a name.`);
  return name;
}

const blank = (value: unknown): string | null =>
  (typeof value === "string" ? value : "").trim() || null;

// ── Body validation (the pydantic models, by hand) ───────────────────────────

function optStr(body: Record<string, any>, key: string, max: number): void {
  const v = body[key];
  if (v === null || v === undefined) return;
  if (typeof v !== "string") throw new HttpError(422, `${key}: must be text`);
  if (v.length > max) throw new HttpError(422, `${key}: at most ${max} characters`);
}

function optInt(body: Record<string, any>, key: string): void {
  const v = body[key];
  if (v === null || v === undefined) return;
  if (typeof v === "string" && /^-?\d+$/.test(v)) body[key] = Number(v);
  else if (!Number.isInteger(v)) throw new HttpError(422, `${key}: must be an integer`);
}

// ── Tree rules ───────────────────────────────────────────────────────────────

async function getFolder(folderId: number): Promise<Row | null> {
  return await fetchrow(
    "SELECT id, name, description, parent_id FROM document_folders WHERE id = $1",
    [folderId],
  );
}

/**
 * Refuse a parent that would make a cycle or push any folder past MAX_DEPTH.
 *
 * Walks up from the proposed parent (bounded by the row count, so an
 * already-corrupt tree degrades to a refusal rather than a hang), then adds the
 * height of the subtree being moved — moving a branch under a deep parent must
 * not sink its grandchildren past the cap.
 */
async function checkNesting(folderId: number | null, parentId: number | null): Promise<void> {
  if (parentId === null) return;
  const rows = await fetch("SELECT id, parent_id FROM document_folders");
  const parentOf = new Map<number, number | null>(rows.map((r) => [r.id, r.parent_id]));
  if (!parentOf.has(parentId)) throw new FolderTreeError("That folder no longer exists.");
  if (folderId !== null && parentId === folderId) {
    throw new FolderTreeError("A folder cannot be moved inside itself.");
  }

  let depth = 1; // the folder being written
  let cur: number | null | undefined = parentId;
  let steps = 0;
  while (cur !== null && cur !== undefined && steps <= rows.length + 1) {
    if (folderId !== null && cur === folderId) {
      throw new FolderTreeError("A folder cannot be moved inside one of its own subfolders.");
    }
    depth += 1;
    cur = parentOf.get(cur);
    steps += 1;
  }

  let height = 1;
  if (folderId !== null) {
    const kids = new Map<number, number[]>();
    for (const [fid, pid] of parentOf) {
      if (pid !== null) {
        if (!kids.has(pid)) kids.set(pid, []);
        kids.get(pid)!.push(fid);
      }
    }
    let level = [folderId];
    const seen = new Set([folderId]);
    while (true) {
      const next = level.flatMap((f) => kids.get(f) ?? []).filter((k) => !seen.has(k));
      if (!next.length) break;
      next.forEach((k) => seen.add(k));
      level = next;
      height += 1;
    }
  }

  if (depth + height - 1 > MAX_DEPTH) {
    throw new FolderTreeError(`Folders can only nest ${MAX_DEPTH} levels deep.`);
  }
}

// ── Folders ──────────────────────────────────────────────────────────────────

/** The whole tree, flat (each row carries parent_id), with a count of the
 *  documents filed directly in each folder. Sorted by name. */
router.get("/folders", async (c) => {
  const folders = await fetch(
    `SELECT f.id, f.name, f.description, f.parent_id, f.created_at,
            COUNT(d.id) AS document_count
     FROM document_folders f
     LEFT JOIN documents d ON d.folder_id = f.id
     GROUP BY f.id
     ORDER BY LOWER(f.name), f.id`,
  );
  return c.json({ folders });
});

router.post("/folders", async (c) => {
  const body = await jsonBody(c);
  if (body.name === undefined || body.name === null) throw new HttpError(422, "name is required");
  optStr(body, "name", 120);
  optStr(body, "description", 2000);
  optInt(body, "parent_id");
  const name = cleanName(body.name, "folder");
  const parentId: number | null = body.parent_id ?? null;

  await checkNesting(null, parentId);
  let r: Row | null;
  try {
    r = await fetchrow(
      `INSERT INTO document_folders (name, description, parent_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, parent_id, created_at`,
      [name, blank(body.description), parentId, currentUser(c).id],
    );
  } catch (err) {
    if (pgCode(err) === UNIQUE_VIOLATION) {
      throw new FolderConflict(`A folder called "${name}" already exists here.`);
    }
    if (pgCode(err) === FOREIGN_KEY_VIOLATION) throw new FolderTreeError("That folder no longer exists.");
    throw err;
  }
  return c.json({ folder: { ...r, document_count: 0 } }, 201);
});

/** Rename, re-describe or move. `parent_id` present (even null) means move;
 *  absent means leave it where it is. */
router.patch("/folders/:id", async (c) => {
  const folderId = intParam(c, "id");
  const body = await jsonBody(c);
  optStr(body, "name", 120);
  optStr(body, "description", 2000);
  optInt(body, "parent_id");
  if (!(await getFolder(folderId))) throw new HttpError(404, "That folder no longer exists.");

  const data: Record<string, any> = {};
  if ("name" in body) data.name = cleanName(body.name, "folder");
  if ("description" in body) data.description = blank(body.description);
  if ("parent_id" in body) data.parent_id = body.parent_id ?? null;

  const sets: string[] = [];
  const params: any[] = [folderId];
  for (const key of ["name", "description", "parent_id"]) {
    if (key in data) {
      params.push(data[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if ("parent_id" in data) await checkNesting(folderId, data.parent_id);
  if (sets.length) {
    try {
      await execute(
        `UPDATE document_folders SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
        params,
      );
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) {
        const name = data.name || await fetchval("SELECT name FROM document_folders WHERE id = $1", [folderId]);
        throw new FolderConflict(`A folder called "${name}" already exists there.`);
      }
      if (pgCode(err) === FOREIGN_KEY_VIOLATION) throw new FolderTreeError("That folder no longer exists.");
      throw err;
    }
  }
  return c.json({ folder: await getFolder(folderId) });
});

/** The folder, every subfolder and every document in them. No undo — the page
 *  arms this behind a second click. Keys are collected first, the CASCADE drops
 *  the rows, then the stored files go. */
router.delete("/folders/:id", async (c) => {
  const folderId = intParam(c, "id");
  const keys = (await fetch(
    `WITH RECURSIVE tree AS (
         SELECT id FROM document_folders WHERE id = $1
         UNION
         SELECT f.id FROM document_folders f JOIN tree t ON f.parent_id = t.id
     )
     SELECT d.file_key FROM documents d WHERE d.folder_id IN (SELECT id FROM tree)`,
    [folderId],
  )).map((r) => r.file_key as string);
  const deleted = (await execute("DELETE FROM document_folders WHERE id = $1", [folderId])) === 1;
  if (!deleted) throw new HttpError(404, "That folder no longer exists.");
  await removeMany("documents", keys);
  return c.json({ deleted: folderId });
});

// ── Documents ────────────────────────────────────────────────────────────────

async function getDocument(docId: number, withKey = false): Promise<Row | null> {
  const r = await fetchrow(
    `SELECT ${DOC_COLUMNS} FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = $1`,
    [docId],
  );
  if (!r) return null;
  const out = shapeDoc(r);
  if (withKey) out.file_key = r.file_key;
  return out;
}

/** One folder's documents, or a search across the whole cabinet. Newest first. */
const listDocuments = async (c: any) => {
  const folderId = intQuery(c, "folder_id");
  const rawSearch = c.req.query("search");
  if (rawSearch && rawSearch.length > 200) throw new HttpError(422, "search: at most 200 characters");
  const search = blank(rawSearch);
  if (folderId === undefined && !search) throw new HttpError(400, "Open a folder or search.");

  const where: string[] = [];
  const params: any[] = [];
  if (folderId !== undefined) {
    params.push(folderId);
    where.push(`d.folder_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(d.name ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
  }
  const rows = await fetch(
    `SELECT ${DOC_COLUMNS}
     FROM documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT 500`,
    params,
  );
  return c.json({ documents: rows.map(shapeDoc) });
};
router.get("/", listDocuments);
router.get("", listDocuments);

/** File a document. The uploaded name is display data (its extension is kept on
 *  the key so the download opens in the right app). */
const uploadDocument = async (c: any) => {
  const form = await c.req.parseBody();
  const rawFolder = form.folder_id;
  if (typeof rawFolder !== "string" || !/^-?\d+$/.test(rawFolder.trim())) {
    throw new HttpError(422, "folder_id must be an integer");
  }
  const folderId = Number(rawFolder.trim());
  const file = await uploadedFile(form);
  if (!(await getFolder(folderId))) throw new HttpError(404, "That folder no longer exists.");
  const filename = (file.name ?? "").split(/[\\/]/).pop()!.trim();
  if (!filename) throw new HttpError(400, "That file has no name.");
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `That file is bigger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`);
  }
  const { key, size, mime } = await store("documents", file);

  const stem = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  const name = (stem.replace(/\s+/g, " ").trim() || "Document").slice(0, 255);
  let doc: Row | null;
  try {
    const docId = await fetchval(
      `INSERT INTO documents (folder_id, name, description, file_key, mime_type, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [folderId, name, null, key, mime, size, currentUser(c).id],
    );
    doc = await getDocument(docId);
  } catch (err) {
    await remove("documents", key);
    throw err;
  }
  return c.json({ document: doc }, 201);
};
router.post("/", uploadDocument);
router.post("", uploadDocument);

/** Rename, re-describe, or move to another folder. The bytes never move. */
router.patch("/:id", async (c) => {
  const docId = intParam(c, "id");
  const body = await jsonBody(c);
  optStr(body, "name", 255);
  optStr(body, "description", 2000);
  optInt(body, "folder_id");
  if (!(await getDocument(docId))) throw new HttpError(404, "That document no longer exists.");

  const data: Record<string, any> = {};
  if ("name" in body) data.name = cleanName(body.name, "document");
  if ("description" in body) data.description = blank(body.description);
  if ("folder_id" in body) {
    if (body.folder_id === null || body.folder_id === undefined) {
      throw new HttpError(400, "A document has to be in a folder.");
    }
    data.folder_id = body.folder_id;
  }

  const sets: string[] = [];
  const params: any[] = [docId];
  for (const key of ["name", "description", "folder_id"]) {
    if (key in data) {
      params.push(data[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (sets.length) {
    try {
      await execute(
        `UPDATE documents SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
        params,
      );
    } catch (err) {
      if (pgCode(err) === FOREIGN_KEY_VIOLATION) throw new FolderTreeError("That folder no longer exists.");
      throw err;
    }
  }
  return c.json({ document: await getDocument(docId) });
});

router.delete("/:id", async (c) => {
  const docId = intParam(c, "id");
  const key = await fetchval("DELETE FROM documents WHERE id = $1 RETURNING file_key", [docId]);
  if (!key) throw new HttpError(404, "That document no longer exists.");
  await remove("documents", key);
  return c.json({ deleted: docId });
});

/** The only route to the bytes. Always an octet-stream attachment, never
 *  rendered inline. */
router.get("/:id/download", async (c) => {
  const docId = intParam(c, "id");
  const doc = await getDocument(docId, true);
  if (!doc) throw new HttpError(404, "That document no longer exists.");
  let blob: Blob | null;
  try {
    blob = await read("documents", doc.file_key);
  } catch {
    console.error("document_bad_key", docId);
    throw new HttpError(404, "That document no longer exists.");
  }
  if (!blob) throw new HttpError(404, "That file is missing from storage. Add it again.");
  const filename = doc.ext ? `${doc.name}.${doc.ext}` : doc.name;
  return attachment(blob, filename);
});
