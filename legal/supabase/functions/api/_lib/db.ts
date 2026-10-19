/**
 * The database, reached directly as the owner role (RLS does not apply).
 *
 * Port of nightingale's `core/database.py` (asyncpg). Queries keep asyncpg's
 * `$1, $2` placeholders through `sql.unsafe(text, params)`, so the SQL in the
 * route modules is nightingale's, character for character where it can be.
 *
 * Values come back the way asyncpg handed them to the FastAPI routes:
 *   DATE         'YYYY-MM-DD' string (never a JS Date: a date-only value parsed
 *                at midnight UTC shows the previous day anywhere west of it)
 *   NUMERIC      string (money is never a float)
 *   BIGINT       number (file sizes, counts — all far below 2^53)
 *   TIMESTAMPTZ  JS Date, which JSON-serialises as ISO 8601
 */
import postgres from "npm:postgres@3.4.5";

const DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!DB_URL) throw new Error("SUPABASE_DB_URL is not set");

export const sql = postgres(DB_URL, {
  // The Supabase pooler runs in transaction mode: no prepared statements.
  prepare: false,
  max: 4,
  idle_timeout: 20,
  types: {
    date: {
      to: 1082,
      from: [1082],
      serialize: (x: string) => x,
      parse: (x: string) => x,
    },
    bigint: {
      to: 20,
      from: [20],
      serialize: (x: number) => String(x),
      parse: (x: string) => Number(x),
    },
  },
});

export type Row = Record<string, any>;
// Anything that can run a query: the pool, or a transaction from `tx`.
export type Db = { unsafe: (q: string, params?: any[]) => Promise<any> };

/** All rows (asyncpg `fetch`). */
export async function fetch(q: string, params: any[] = [], db: Db = sql): Promise<Row[]> {
  return [...(await db.unsafe(q, params))];
}

/** First row or null (asyncpg `fetchrow`). */
export async function fetchrow(q: string, params: any[] = [], db: Db = sql): Promise<Row | null> {
  const rows = await db.unsafe(q, params);
  return rows.length ? rows[0] : null;
}

/** First column of the first row, or null (asyncpg `fetchval`). */
export async function fetchval(q: string, params: any[] = [], db: Db = sql): Promise<any> {
  const row = await fetchrow(q, params, db);
  return row ? Object.values(row)[0] : null;
}

/** Statement with no rows wanted; returns the affected-row count (asyncpg `execute`). */
export async function execute(q: string, params: any[] = [], db: Db = sql): Promise<number> {
  const res = await db.unsafe(q, params);
  return res.count ?? 0;
}

/** One transaction (asyncpg `async with conn.transaction()`). */
export function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return sql.begin((t: any) => fn(t)) as Promise<T>;
}

/** The Postgres error code of a failed query (asyncpg's exception classes). */
export const pgCode = (err: unknown): string | undefined => (err as any)?.code;
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
export const CHECK_VIOLATION = "23514";
