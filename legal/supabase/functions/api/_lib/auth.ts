/**
 * Who is calling. Port of nightingale's `api/deps.py` and the partner gate
 * from `api/accounts.py`.
 *
 * The browser signs in with Supabase Auth and sends its access token as the
 * bearer. The token is verified against Supabase Auth, then resolved to the
 * `public.users` row linked by `auth_id`; that row's role and active flag are
 * what every route checks, exactly as the JWT's user id was resolved before.
 */
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import type { Context, MiddlewareHandler } from "npm:hono@4.6.14";
import { fetchrow, type Row } from "./db.ts";
import { HttpError } from "./http.ts";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export type User = Row & {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
};

export type Env = { Variables: { user: User } };

const unauthorized = () => new HttpError(401, "Could not validate credentials");

/** get_current_active_user: a signed-in login with an active users row. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw unauthorized();

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw unauthorized();

  const user = await fetchrow(
    "SELECT id, auth_id, email, full_name, role, is_active, last_login FROM users WHERE auth_id = $1",
    [data.user.id],
  );
  if (!user) throw unauthorized();
  if (!user.is_active) throw new HttpError(400, "Inactive user");

  c.set("user", user as User);
  await next();
};

export const currentUser = (c: Context<Env>): User => c.get("user");

/** get_current_admin. */
export function assertAdmin(user: User): void {
  if (user.role !== "super_admin") {
    throw new HttpError(403, "The user doesn't have enough privileges");
  }
}

// ── Partners (Account Management + Documents) ────────────────────────────────
// Access is by login EMAIL, not role: a super_admin who is not a partner is
// refused like anyone else. Override with the ACCOUNTS_ALLOWED_EMAILS secret.
const DEFAULT_PARTNERS = "bhavninder@kavasconsultancy.com,rahul@kavasconsultancy.com";

export function allowedEmails(): string[] {
  return (Deno.env.get("ACCOUNTS_ALLOWED_EMAILS") ?? DEFAULT_PARTNERS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isPartner = (user: User): boolean =>
  allowedEmails().includes((user.email ?? "").toLowerCase());

/** require_partner. */
export function assertPartner(user: User): void {
  if (!isPartner(user)) throw new HttpError(403, "Not allowed");
}

export const requirePartner: MiddlewareHandler<Env> = async (c, next) => {
  assertPartner(currentUser(c));
  await next();
};
