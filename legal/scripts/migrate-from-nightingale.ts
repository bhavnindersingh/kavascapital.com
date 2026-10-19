/**
 * One-off copy of nightingale's partner workspace into the legal Supabase
 * project: logins, the task board, the Account Management ledger, the
 * Documents cabinet, and the files behind all three.
 *
 * READS the nightingale database and WRITES only to Supabase. The source
 * session is opened READ ONLY, so pointing it at production cannot change
 * anything there — but the safe default is still a snapshot
 * (nightingale's scripts/snapshot-prod-db.sh) or the read-only door in its
 * docs/us-port/REMOTE_DB.md.
 *
 * Ids are kept exactly, so every foreign key (assignees, board owners,
 * dependency edges, folder parents) means what it meant. The target must be
 * empty: run it once, after `supabase db push`, before anyone uses the app.
 *
 * Passwords do not come across. Nightingale hashes with passlib
 * pbkdf2_sha256, which Supabase Auth cannot read, so each login gets a fresh
 * random password and `--links` prints a one-time link to set their own.
 *
 * Usage (from legal/):
 *   SOURCE_DATABASE_URL=postgresql://…nightingale…        \
 *   TARGET_DATABASE_URL=postgresql://postgres:…@db.jgljyprtjtndujujdvuy.supabase.co:5432/postgres \
 *   SUPABASE_URL=https://jgljyprtjtndujujdvuy.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=…                           \
 *   UPLOADS_DIR=./nightingale-uploads                     \
 *   deno run -A --node-modules-dir=none scripts/migrate-from-nightingale.ts [--dry-run] [--links]
 *
 * UPLOADS_DIR is a local copy of nightingale's `backend/uploads` (it holds
 * tasks/, accounts/ and documents/), e.g.
 *   scp -r -i kavas-us.pem ubuntu@54.153.24.106:/opt/kavas-us/backend/uploads ./nightingale-uploads
 */
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const DRY_RUN = Deno.args.includes("--dry-run");
const LINKS = Deno.args.includes("--links");
// Optional: the password both logins start with. Unset = a random one, and
// each person sets their own from a reset email.
const INITIAL_PASSWORD = Deno.env.get("INITIAL_PASSWORD") || null;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`${name} is not set. See the header of this script.`);
    Deno.exit(1);
  }
  return v;
}

// Dates as 'YYYY-MM-DD' text and BIGINT as numbers on both sides, so nothing
// is re-parsed through a JS Date (a date-only value at midnight UTC would
// land on the previous day west of Greenwich).
const types = {
  date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
};

const source = postgres(env("SOURCE_DATABASE_URL"), { max: 1, types });
const target = postgres(env("TARGET_DATABASE_URL"), { max: 1, prepare: false, types });
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://legal.kavascapital.com";
const UPLOADS_DIR = env("UPLOADS_DIR");
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// In foreign-key order. `bucket` names where a table's file_key objects go.
const TABLES: { name: string; bucket?: "tasks" | "accounts" | "documents" }[] = [
  { name: "task_boards" },
  { name: "tasks" },
  { name: "task_subtasks" },
  { name: "task_comments" },
  { name: "task_dependencies" },
  { name: "task_events" },
  { name: "task_files", bucket: "tasks" },
  { name: "account_entries" },
  { name: "account_files", bucket: "accounts" },
  // Parents before children: a folder's parent always has a smaller id, as
  // nightingale only ever inserts under an existing folder — but a MOVE can
  // put a folder under a newer one, so these rows are ordered by depth below.
  { name: "document_folders" },
  { name: "documents", bucket: "documents" },
];
const BANNED = "876000h";

// Only the two partners move across (owner, 2026-10-18), under their
// kavasconsultancy.com logins, as admins. Nightingale email → login here.
const KEEP_USERS: Record<string, string> = {
  "bhavnindersingh@gmail.com": "bhavninder@kavasconsultancy.com",
  "rahulbhayana10@gmail.com": "rahul@kavasconsultancy.com",
};
// Columns that point at a person. A row naming someone left behind keeps
// the row and loses the name (the same as nightingale's ON DELETE SET NULL);
// the task trail keeps its frozen actor_name either way.
const PERSON_COLUMNS = [
  "created_by", "owner_user_id", "assignee_user_id",
  "author_user_id", "actor_user_id", "uploaded_by",
];

async function columns(db: postgres.Sql, table: string): Promise<string[]> {
  const rows = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position`;
  return rows.map((r) => r.column_name as string);
}

async function sourceRows(table: string, cols: string[]): Promise<postgres.Row[]> {
  const list = cols.map((c) => `"${c}"`).join(", ");
  if (table === "document_folders") {
    return [...await source.unsafe(`
      WITH RECURSIVE tree AS (
        SELECT id, 0 AS depth FROM document_folders WHERE parent_id IS NULL
        UNION ALL
        SELECT f.id, t.depth + 1 FROM document_folders f JOIN tree t ON f.parent_id = t.id
      )
      SELECT ${cols.map((c) => `f."${c}"`).join(", ")}
      FROM document_folders f JOIN tree USING (id) ORDER BY tree.depth, f.id`)];
  }
  return [...await source.unsafe(`SELECT ${list} FROM ${table} ORDER BY id`)];
}

/** Every Supabase Auth user, by lower-cased email. */
async function authUsersByEmail(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) out.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) return out;
  }
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

async function main() {
  await source`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;

  // ── The target must be empty ──────────────────────────────────────────────
  for (const t of ["users", ...TABLES.map((t) => t.name)]) {
    const [{ n }] = await target.unsafe(`SELECT COUNT(*)::int AS n FROM ${t}`);
    if (n > 0) {
      console.error(`Target table ${t} already has ${n} rows. This script only fills an empty project.`);
      Deno.exit(1);
    }
  }

  // ── What there is to copy ─────────────────────────────────────────────────
  type SourceUser = {
    id: number; email: string; full_name: string; role: string; is_active: boolean;
    last_login: Date | null; created_at: Date; updated_at: Date;
  };
  const allUsers = [...await source<SourceUser[]>`
    SELECT id, LOWER(email) AS email, full_name, role, is_active, last_login, created_at, updated_at
    FROM users ORDER BY id`];
  const users = allUsers
    .filter((u) => KEEP_USERS[u.email])
    .map((u) => ({ ...u, email: KEEP_USERS[u.email], role: "super_admin", is_active: true }));
  const kept = new Set(users.map((u) => u.id));
  const missingPartners = Object.keys(KEEP_USERS).filter((e) => !allUsers.some((u) => u.email === e));
  if (missingPartners.length) console.warn(`  not found in nightingale, so not created: ${missingPartners.join(", ")}`);
  const left = allUsers.filter((u) => !kept.has(u.id)).map((u) => u.email);
  if (left.length) console.log(`  logins left behind: ${left.join(", ")}`);
  const plan: { name: string; bucket?: string; cols: string[]; rows: postgres.Row[] }[] = [];
  for (const t of TABLES) {
    const tgt = new Set(await columns(target, t.name));
    const src = await columns(source, t.name);
    if (!src.length) {
      console.warn(`  ${t.name}: not in the source database, skipped`);
      plan.push({ ...t, cols: [], rows: [] });
      continue;
    }
    const cols = src.filter((c) => tgt.has(c));
    const dropped = src.filter((c) => !tgt.has(c));
    if (dropped.length) console.warn(`  ${t.name}: source columns not in target, left behind: ${dropped.join(", ")}`);
    const rows = await sourceRows(t.name, cols);
    for (const row of rows) {
      for (const c of PERSON_COLUMNS) {
        if (c in row && row[c] != null && !kept.has(row[c])) row[c] = null;
      }
      // Ledger ownership is by email: carry it to the new login.
      if (row.owner_email) row.owner_email = KEEP_USERS[String(row.owner_email).toLowerCase()] ?? row.owner_email;
    }
    plan.push({ ...t, cols, rows });
  }

  console.log(`users: ${users.length}`);
  for (const p of plan) console.log(`${p.name}: ${p.rows.length}`);
  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  // ── Logins ────────────────────────────────────────────────────────────────
  // Auth users are made (or found) first; their ids go into users.auth_id.
  const existing = await authUsersByEmail();
  const authIds = new Map<number, string>();
  for (const u of users) {
    let id = existing.get(u.email);
    if (!id) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: INITIAL_PASSWORD ?? randomPassword(),
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
        ...(u.is_active ? {} : { ban_duration: BANNED }),
      });
      if (error || !data.user) throw new Error(`auth user for ${u.email}: ${error?.message}`);
      id = data.user.id;
    }
    authIds.set(u.id, id);
  }

  // ── Rows, in one transaction ──────────────────────────────────────────────
  await target.begin(async (tx) => {
    for (const u of users) {
      await tx`
        INSERT INTO users (id, auth_id, email, full_name, role, is_active, last_login, created_at, updated_at)
        VALUES (${u.id}, ${authIds.get(u.id)!}, ${u.email}, ${u.full_name}, ${u.role}, ${u.is_active},
                ${u.last_login}, ${u.created_at}, ${u.updated_at})`;
    }
    for (const p of plan) {
      for (let i = 0; i < p.rows.length; i += 500) {
        await tx`INSERT INTO ${tx(p.name)} ${tx(p.rows.slice(i, i + 500), ...p.cols)}`;
      }
    }
    // Next ids continue after the copied ones.
    for (const t of ["users", ...TABLES.map((t) => t.name)]) {
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('public.${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`,
      );
    }
  });
  console.log("\nRows copied.");

  // ── Files ─────────────────────────────────────────────────────────────────
  const missing: string[] = [];
  let uploaded = 0;
  for (const p of plan) {
    if (!p.bucket) continue;
    for (const row of p.rows) {
      const key = row.file_key as string;
      const path = `${UPLOADS_DIR}/${p.bucket}/${key}`;
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(path);
      } catch {
        missing.push(`${p.name} #${row.id} "${row.name}" (${path})`);
        continue;
      }
      const { error } = await supabase.storage.from(p.bucket).upload(key, bytes, {
        contentType: "application/octet-stream",
        upsert: true,
      });
      if (error) throw new Error(`upload ${p.bucket}/${key}: ${error.message}`);
      uploaded++;
    }
  }
  console.log(`Files uploaded: ${uploaded}`);
  if (missing.length) {
    console.warn(`\n${missing.length} file(s) not found under UPLOADS_DIR (their rows were still copied):`);
    for (const m of missing) console.warn(`  ${m}`);
  }

  // ── First passwords ───────────────────────────────────────────────────────
  if (LINKS) {
    console.log("\nOne-time links to set a password (send each to its owner, privately):");
    for (const u of users.filter((u) => u.is_active)) {
      const { data, error } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: u.email,
        options: { redirectTo: `${SITE_URL}/reset-password` },
      });
      console.log(`  ${u.email}: ${error ? `failed — ${error.message}` : data.properties.action_link}`);
    }
  } else {
    console.log("\nNo --links: each person needs a reset link from the Users page before they can sign in.");
  }
}

try {
  await main();
} finally {
  await source.end();
  await target.end();
}
