/**
 * FastAPI's HTTPException, so ported routes read the way they did: throw
 * `new HttpError(400, "…")` and the client gets `{ "detail": "…" }` — the shape
 * every page's error toast already reads (`err.response.data.detail`).
 */
import type { Context } from "npm:hono@4.6.14";

export class HttpError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

export const notFound = (detail = "Not found") => new HttpError(404, detail);
export const badRequest = (detail: unknown) => new HttpError(400, detail);
export const forbidden = (detail = "Not allowed") => new HttpError(403, detail);

/** Request JSON body, or {} when there is none. A malformed body is a 422, as in FastAPI. */
export async function jsonBody(c: Context): Promise<Record<string, any>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch { /* fall through */ }
  throw new HttpError(422, "The request body is not a JSON object.");
}

/** A path parameter that must be an integer id (FastAPI's `int` path type). */
export function intParam(c: Context, name: string): number {
  const raw = c.req.param(name) ?? "";
  if (!/^-?\d+$/.test(raw)) throw new HttpError(422, `${name} must be an integer`);
  return Number(raw);
}

/** An optional integer query parameter. */
export function intQuery(c: Context, name: string): number | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return undefined;
  if (!/^-?\d+$/.test(raw)) throw new HttpError(422, `${name} must be an integer`);
  return Number(raw);
}

/** An optional boolean query parameter ("true"/"false"/"1"/"0"). */
export function boolQuery(c: Context, name: string): boolean | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return undefined;
  if (["true", "1", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new HttpError(422, `${name} must be a boolean`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A 'YYYY-MM-DD' that is a real calendar day, or throws 422. */
export function isoDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new HttpError(422, `${name} must be a date (YYYY-MM-DD)`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(422, `${name} is not a real date`);
  }
  return value;
}
