/**
 * Account Management — the two partners only.
 *
 * Port of nightingale's `api/accounts.py` + `services/account_service.py`
 * (working tree of 2026-10-15: ten major heads, no "Pay salaries" route).
 *
 * The ledger: salaries, company spending by major head, assets and personal
 * expenses, each either JOINT (`owner_email` NULL) or one partner's own. Access
 * is by login email (ACCOUNTS_ALLOWED_EMAILS), not by role: a super_admin who
 * is not a partner is refused like anyone else.
 *
 * Money is NUMERIC in Postgres and a string here, in and out, so the UI never
 * sees a float rounding of somebody's salary.
 */
import { Hono } from "npm:hono@4.6.14";
import { allowedEmails, currentUser, isPartner, requirePartner, type Env } from "./_lib/auth.ts";
import { execute, fetch, fetchrow, fetchval, type Row } from "./_lib/db.ts";
import { HttpError, boolQuery, intParam, isoDate, jsonBody } from "./_lib/http.ts";
import { MAX_BYTES, attachment, read, remove, removeMany, store, uploadedFile } from "./_lib/storage.ts";

export const router = new Hono<Env>();

// Major heads (owner 2026-10-15, as in the Kavas Consultancy books). `company`
// is the catch-all "Other"; `purchase` is assets the CA depreciates.
const CATEGORIES = [
  "salary", "office", "subscription", "marketing", "travel",
  "professional", "purchase", "tax_bank", "company", "personal",
];
const CURRENCIES = ["INR", "USD"];
// Fits NUMERIC(14, 2).
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
// State code, PAN, entity number, 'Z', checksum — the shape every GSTIN has.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// `owner` filter value meaning "joint entries only".
const JOINT = "joint";

// A salary or a personal expense is always ONE partner's; only company
// spending (running costs, assets) can be joint.
const PER_PERSON = new Set(["salary", "personal"]);

const COLUMNS = `
    e.id, e.entry_date, e.category, e.party, e.description, e.amount,
    e.currency, e.payment_method, e.owner_email, e.notes,
    e.paid_from, e.reference_no, e.payee_account, e.bank_narration,
    e.gst_applicable, e.vendor_gstin, e.invoice_no, e.invoice_date,
    e.gst_rate, e.taxable_value, e.gst_amount, e.salary_month,
    e.created_by, u.full_name AS created_by_name, e.created_at, e.updated_at
`;

// Fields a create/update may set — the allowlist that keeps column names out
// of user input when the INSERT/UPDATE is built.
const WRITABLE = [
  "entry_date", "category", "party", "description", "amount", "currency",
  "payment_method", "owner_email", "notes",
  "paid_from", "reference_no", "payee_account", "bank_narration",
  "gst_applicable", "vendor_gstin", "invoice_no", "invoice_date",
  "gst_rate", "taxable_value", "gst_amount", "salary_month",
];

const FILE_COLUMNS = `
    f.id, f.entry_id, f.name, f.mime_type, f.file_size, f.uploaded_by,
    u.full_name AS uploaded_by_name, f.created_at
`;

/** A Postgres array literal, for `= ANY($n::text[])` / `::int[]`. */
const pgArray = (values: (string | number)[]) =>
  `{${values.map((v) => (typeof v === "number" ? String(v) : `"${v.replace(/["\\]/g, "\\$&")}"`)).join(",")}}`;

// ── Validation (the pydantic models, by hand) ────────────────────────────────

type Spec =
  | { kind: "str"; max: number; min?: number }
  | { kind: "date" }
  | { kind: "money"; max100?: boolean }
  | { kind: "enum"; values: string[] }
  | { kind: "bool" };

// _Details: the optional fields shared by create and update.
const DETAILS: Record<string, Spec> = {
  party: { kind: "str", max: 200 },
  payment_method: { kind: "str", max: 50 },
  owner_email: { kind: "str", max: 255 }, // null = joint
  notes: { kind: "str", max: 5000 },
  // Transfer details — what the bank statement shows, for matching.
  paid_from: { kind: "str", max: 120 },
  reference_no: { kind: "str", max: 120 },
  payee_account: { kind: "str", max: 200 },
  bank_narration: { kind: "str", max: 2000 },
  // GST invoice.
  vendor_gstin: { kind: "str", max: 20 },
  invoice_no: { kind: "str", max: 60 },
  invoice_date: { kind: "date" },
  gst_rate: { kind: "money", max100: true },
  taxable_value: { kind: "money" },
  gst_amount: { kind: "money" },
  // Salaries only: the month the payment is for (any day; stored as the 1st).
  salary_month: { kind: "date" },
};

const CORE: Record<string, Spec> = {
  entry_date: { kind: "date" },
  category: { kind: "enum", values: CATEGORIES },
  description: { kind: "str", min: 1, max: 500 },
  amount: { kind: "money" },
  currency: { kind: "enum", values: CURRENCIES },
  gst_applicable: { kind: "bool" },
};

const SPECS: Record<string, Spec> = { ...DETAILS, ...CORE };

function checkValue(key: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const spec = SPECS[key];
  const bad = (why: string) => new HttpError(422, `${key}: ${why}`);
  switch (spec.kind) {
    case "str":
      if (typeof v !== "string") throw bad("must be text");
      if (v.length > spec.max) throw bad(`at most ${spec.max} characters`);
      if (spec.min && v.length < spec.min) throw bad(`at least ${spec.min} character`);
      return v;
    case "date":
      return isoDate(v, key);
    case "money": {
      const s = typeof v === "number" ? String(v) : v;
      if (typeof s !== "string" || !MONEY_RE.test(s.trim())) {
        throw bad("must be a non-negative amount with at most 2 decimal places");
      }
      // A comparison only, never arithmetic on the stored value.
      if (spec.max100 && Number(s) > 100) throw bad("must be at most 100");
      return s.trim();
    }
    case "enum":
      if (typeof v !== "string" || !spec.values.includes(v)) {
        throw bad(`must be one of ${spec.values.join(", ")}`);
      }
      return v;
    case "bool":
      if (typeof v !== "boolean") throw bad("must be true or false");
      return v;
  }
}

/** Only the known fields that are PRESENT (pydantic exclude_unset), validated. */
function parseBody(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of Object.keys(SPECS)) {
    if (key in body) out[key] = checkValue(key, body[key]);
  }
  return out;
}

function checkOwner(ownerEmail: string | null): string | null {
  // null = joint. Anything else must be one of the partners.
  if (ownerEmail === null || ownerEmail === undefined) return null;
  const email = ownerEmail.trim().toLowerCase();
  if (!allowedEmails().includes(email)) {
    throw new HttpError(400, "Owner must be joint or one of the partners");
  }
  return email;
}

function checkPerPerson(category: string | null | undefined, ownerEmail: string | null): void {
  if (category && PER_PERSON.has(category) && ownerEmail === null) {
    const what = category === "salary" ? "A salary" : "A personal expense";
    throw new HttpError(400, `${what} belongs to one person. Pick whose it is.`);
  }
}

/** A salary is for a month: normalise to the 1st, defaulting to the pay date's
 *  month. Anything that isn't a salary carries none. */
function salaryMonth(data: Record<string, any>, category: string | null | undefined): void {
  if (category === "salary") {
    const month: string | null = data.salary_month || data.entry_date;
    if (month) data.salary_month = `${month.slice(0, 8)}01`;
  } else if (category !== null && category !== undefined) {
    data.salary_month = null;
  }
}

/** Trim text, blank -> null, normalise owner and GSTIN. */
function clean(data: Record<string, any>): Record<string, any> {
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") data[k] = v.trim() || null;
  }
  if ("owner_email" in data) data.owner_email = checkOwner(data.owner_email);
  if (data.vendor_gstin) {
    const gstin = String(data.vendor_gstin).toUpperCase().replaceAll(" ", "");
    if (!GSTIN_RE.test(gstin)) {
      throw new HttpError(
        400,
        "That GSTIN doesn't look right. It should be 15 characters, like 07AABCU9603R1ZM.",
      );
    }
    data.vendor_gstin = gstin;
  }
  return data;
}

// ── Service ──────────────────────────────────────────────────────────────────

/** The partners, in allowlist order, named from their user rows when they have one. */
async function people(emails: string[]): Promise<{ email: string; name: string }[]> {
  const rows = await fetch(
    "SELECT LOWER(email) AS email, full_name FROM users WHERE LOWER(email) = ANY($1::text[])",
    [pgArray(emails)],
  );
  const names = new Map(rows.map((r) => [r.email, r.full_name]));
  return emails.map((e) => ({ email: e, name: names.get(e) || e.split("@")[0] }));
}

function filters(
  category: string | undefined,
  owner: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  search: string | undefined,
  gstOnly = false,
): [string, any[]] {
  const where: string[] = [];
  const params: any[] = [];
  const add = (clause: string, value: any) => {
    params.push(value);
    where.push(clause.replaceAll("{n}", String(params.length)));
  };
  if (category) add("e.category = ${n}", category);
  if (owner === JOINT) where.push("e.owner_email IS NULL");
  else if (owner) add("e.owner_email = ${n}", owner);
  if (dateFrom) add("e.entry_date >= ${n}::date", dateFrom);
  if (dateTo) add("e.entry_date <= ${n}::date", dateTo);
  if (gstOnly) where.push("e.gst_applicable");
  if (search) {
    // Everything a person might paste from a statement or an invoice.
    add(
      "(e.description ILIKE ${n} OR e.party ILIKE ${n} OR e.notes ILIKE ${n}" +
        " OR e.reference_no ILIKE ${n} OR e.bank_narration ILIKE ${n}" +
        " OR e.payee_account ILIKE ${n} OR e.invoice_no ILIKE ${n}" +
        " OR e.vendor_gstin ILIKE ${n} OR e.paid_from ILIKE ${n})",
      `%${search}%`,
    );
  }
  return [where.length ? `WHERE ${where.join(" AND ")}` : "", params];
}

async function filesFor(entryIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>();
  if (!entryIds.length) return out;
  const rows = await fetch(
    `SELECT ${FILE_COLUMNS}
     FROM account_files f
     LEFT JOIN users u ON u.id = f.uploaded_by
     WHERE f.entry_id = ANY($1::int[])
     ORDER BY f.created_at, f.id`,
    [pgArray(entryIds)],
  );
  for (const r of rows) {
    if (!out.has(r.entry_id)) out.set(r.entry_id, []);
    out.get(r.entry_id)!.push(r);
  }
  return out;
}

async function getEntry(entryId: number): Promise<Row | null> {
  const r = await fetchrow(
    `SELECT ${COLUMNS}
     FROM account_entries e
     LEFT JOIN users u ON u.id = e.created_by
     WHERE e.id = $1`,
    [entryId],
  );
  if (!r) return null;
  const files = await filesFor([entryId]);
  return { ...r, files: files.get(entryId) ?? [] };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Whether the caller may open the page (drives the sidebar link). Never 403s. */
router.get("/access", async (c) => {
  const user = currentUser(c);
  if (!isPartner(user)) return c.json({ allowed: false, people: [] });
  return c.json({ allowed: true, people: await people(allowedEmails()) });
});

router.use("*", requirePartner);

function ownerQuery(raw: string | undefined): string | undefined {
  if (raw && raw.length > 255) throw new HttpError(422, "owner: at most 255 characters");
  if (raw && raw !== JOINT) return checkOwner(raw) ?? undefined;
  return raw || undefined;
}

function dateQuery(raw: string | undefined, name: string): string | undefined {
  return raw ? isoDate(raw, name) : undefined;
}

const listEntries = async (c: any) => {
  const category = c.req.query("category") || undefined;
  if (category && !CATEGORIES.includes(category)) {
    throw new HttpError(422, `category: must be one of ${CATEGORIES.join(", ")}`);
  }
  const owner = ownerQuery(c.req.query("owner"));
  const dateFrom = dateQuery(c.req.query("date_from"), "date_from");
  const dateTo = dateQuery(c.req.query("date_to"), "date_to");
  const search = c.req.query("search") || undefined;
  if (search && search.length > 200) throw new HttpError(422, "search: at most 200 characters");
  const gstOnly = boolQuery(c, "gst_only") ?? false;

  // The totals deliberately ignore `category` and `owner` so the summary always
  // shows every bucket for the period, whichever slice the table shows.
  const [whereSql, params] = filters(category, owner, dateFrom, dateTo, search, gstOnly);
  const [sumWhere, sumParams] = filters(undefined, undefined, dateFrom, dateTo, search, gstOnly);
  const rows = await fetch(
    `SELECT ${COLUMNS}
     FROM account_entries e
     LEFT JOIN users u ON u.id = e.created_by
     ${whereSql}
     ORDER BY e.entry_date DESC, e.id DESC`,
    params,
  );
  const files = await filesFor(rows.map((r) => r.id));
  const sums = await fetch(
    `SELECT e.category, e.currency, e.owner_email,
            SUM(e.amount) AS total, COUNT(*) AS count
     FROM account_entries e
     ${sumWhere}
     GROUP BY e.category, e.currency, e.owner_email
     ORDER BY e.category, e.currency, e.owner_email`,
    sumParams,
  );
  return c.json({
    entries: rows.map((r) => ({ ...r, files: files.get(r.id) ?? [] })),
    totals: sums.map((s) => ({
      category: s.category,
      currency: s.currency,
      owner_email: s.owner_email,
      total: String(s.total),
      count: Number(s.count),
    })),
  });
};
router.get("/", listEntries);
router.get("", listEntries);

/** Month x category x currency sums for the trend chart (follows the owner filter). */
router.get("/monthly", async (c) => {
  const rawFrom = c.req.query("date_from");
  const rawTo = c.req.query("date_to");
  if (!rawFrom) throw new HttpError(422, "date_from is required");
  if (!rawTo) throw new HttpError(422, "date_to is required");
  const dateFrom = isoDate(rawFrom, "date_from");
  const dateTo = isoDate(rawTo, "date_to");
  const owner = ownerQuery(c.req.query("owner"));
  const [whereSql, params] = filters(undefined, owner, dateFrom, dateTo, undefined);
  const rows = await fetch(
    `SELECT TO_CHAR(e.entry_date, 'YYYY-MM') AS month, e.category, e.currency,
            SUM(e.amount) AS total
     FROM account_entries e
     ${whereSql}
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3`,
    params,
  );
  return c.json({
    months: rows.map((r) => ({
      month: r.month, category: r.category, currency: r.currency, total: String(r.total),
    })),
  });
});

const createEntry = async (c: any) => {
  const body = await jsonBody(c);
  for (const key of ["entry_date", "category", "description", "amount"]) {
    if (body[key] === undefined || body[key] === null) throw new HttpError(422, `${key} is required`);
  }
  // EntryCreate: every field, with its defaults.
  const data: Record<string, any> = {
    ...Object.fromEntries(Object.keys(DETAILS).map((k) => [k, null])),
    currency: "INR",
    gst_applicable: false,
    ...parseBody(body),
  };
  if (data.currency === null) throw new HttpError(422, "currency: must be one of INR, USD");
  if (data.gst_applicable === null) data.gst_applicable = false;
  clean(data);
  if (!data.description) throw new HttpError(400, "description cannot be empty");
  checkPerPerson(data.category, data.owner_email);
  salaryMonth(data, data.category);

  const fields = WRITABLE.filter((k) => k in data);
  const cols = [...fields, "created_by"].join(", ");
  const marks = fields.map((_, i) => `$${i + 1}`).concat(`$${fields.length + 1}`).join(", ");
  const entryId = await fetchval(
    `INSERT INTO account_entries (${cols}) VALUES (${marks}) RETURNING id`,
    [...fields.map((k) => data[k]), currentUser(c).id],
  );
  return c.json(await getEntry(entryId));
};
router.post("/", createEntry);
router.post("", createEntry);

router.patch("/:id", async (c) => {
  const entryId = intParam(c, "id");
  let data = parseBody(await jsonBody(c));
  // The NOT NULL columns can be changed but never blanked.
  for (const key of ["entry_date", "category", "description", "amount", "currency"]) {
    if (key in data && data[key] === null) throw new HttpError(400, `${key} cannot be empty`);
  }
  if (data.gst_applicable === null || data.gst_applicable === undefined) delete data.gst_applicable;
  data = clean(data);
  if ("description" in data && !data.description) {
    throw new HttpError(400, "description cannot be empty");
  }
  if ("category" in data || "owner_email" in data) {
    const current = await getEntry(entryId);
    if (!current) throw new HttpError(404, "Entry not found");
    checkPerPerson(
      "category" in data ? data.category : current.category,
      "owner_email" in data ? data.owner_email : current.owner_email,
    );
  }
  if ("category" in data || data.salary_month) {
    if (!("category" in data)) {
      const current = await getEntry(entryId);
      if (!current) throw new HttpError(404, "Entry not found");
      if (current.category !== "salary") delete data.salary_month;
    }
    salaryMonth(data, "category" in data ? data.category : "salary");
  }

  const fields = WRITABLE.filter((k) => k in data);
  if (fields.length) {
    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    await execute(
      `UPDATE account_entries SET ${sets}, updated_at = NOW() WHERE id = $1`,
      [entryId, ...fields.map((k) => data[k])],
    );
  }
  const entry = await getEntry(entryId);
  if (!entry) throw new HttpError(404, "Entry not found");
  return c.json(entry);
});

/** Delete the entry; CASCADE drops its file rows, then the stored files go. */
router.delete("/:id", async (c) => {
  const entryId = intParam(c, "id");
  const keys = (await fetch("SELECT file_key FROM account_files WHERE entry_id = $1", [entryId]))
    .map((r) => r.file_key as string);
  const deleted = (await execute("DELETE FROM account_entries WHERE id = $1", [entryId])) === 1;
  if (!deleted) throw new HttpError(404, "Entry not found");
  await removeMany("accounts", keys);
  return c.json({ deleted: entryId });
});

// ── Attachments (invoices, payment screenshots) ──────────────────────────────

/** Attach an invoice or screenshot. The name is display data, the stored key is ours. */
router.post("/:id/files", async (c) => {
  const entryId = intParam(c, "id");
  if (!(await fetchval("SELECT id FROM account_entries WHERE id = $1", [entryId]))) {
    throw new HttpError(404, "That entry is gone.");
  }
  const file = await uploadedFile(await c.req.parseBody());
  const name = (file.name ?? "").split(/[\\/]/).pop()!.trim().slice(0, 255);
  if (!name) throw new HttpError(400, "That file has no name.");
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `That file is bigger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`);
  }
  const { key, size, mime } = await store("accounts", file);
  let row: Row | null;
  try {
    const fileId = await fetchval(
      `INSERT INTO account_files (entry_id, name, file_key, mime_type, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [entryId, name, key, mime, size, currentUser(c).id],
    );
    row = await fetchrow(
      `SELECT ${FILE_COLUMNS} FROM account_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`,
      [fileId],
    );
  } catch (err) {
    await remove("accounts", key);
    throw err;
  }
  return c.json({ file: row }, 201);
});

/** The only route to the bytes. Always an octet-stream attachment. */
router.get("/:id/files/:fileId/download", async (c) => {
  const entryId = intParam(c, "id");
  const fileId = intParam(c, "fileId");
  const row = await fetchrow(
    "SELECT id, entry_id, name, file_key, mime_type FROM account_files WHERE id = $1 AND entry_id = $2",
    [fileId, entryId],
  );
  if (!row) throw new HttpError(404, "That file is gone.");
  let blob: Blob | null;
  try {
    blob = await read("accounts", row.file_key);
  } catch {
    console.error("account_file_bad_key", fileId);
    throw new HttpError(404, "That file is gone.");
  }
  if (!blob) throw new HttpError(404, "That file is no longer stored. Attach it again.");
  return attachment(blob, row.name);
});

router.delete("/:id/files/:fileId", async (c) => {
  const entryId = intParam(c, "id");
  const fileId = intParam(c, "fileId");
  const key = await fetchval(
    "DELETE FROM account_files WHERE id = $1 AND entry_id = $2 RETURNING file_key",
    [fileId, entryId],
  );
  if (!key) throw new HttpError(404, "That file is gone.");
  await remove("accounts", key);
  return c.json({ deleted: fileId });
});
