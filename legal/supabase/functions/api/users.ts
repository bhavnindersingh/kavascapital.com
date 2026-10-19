/**
 * User management (super_admin only). Port of nightingale's `api/users.py`.
 *
 * A login is two rows: the Supabase Auth user (email + password) and our
 * `users` row (name, role, active flag), linked by `users.auth_id`. Creating a
 * user makes both; deactivating flips `is_active` (and bans the auth user, so
 * no new session can be started) rather than deleting anything, so the tasks
 * and ledger rows that name them keep their history.
 */
import { Hono } from "npm:hono@4.6.14";
import { admin, assertAdmin, currentUser, type Env, type User } from "./_lib/auth.ts";
import { execute, fetch, fetchrow, type Row } from "./_lib/db.ts";
import { HttpError, intParam, jsonBody } from "./_lib/http.ts";
import { recoveryLink, sendAuthMail } from "./_lib/mail.ts";

export const router = new Hono<Env>();

// Platform roles. 'manager' and 'trader' work the task board like nightingale;
// 'viewer' is read-only and is refused by the board.
const ALLOWED_ROLES = new Set(["viewer", "trader", "manager", "super_admin"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Banned "for ever" in Supabase Auth terms.
const BANNED = "876000h";

const COLUMNS = "id, email, full_name, role, is_active, last_login";

router.use("*", async (c, next) => {
  assertAdmin(currentUser(c));
  await next();
});

const shape = (r: Row) => ({
  id: r.id,
  email: r.email,
  full_name: r.full_name,
  role: r.role,
  is_active: r.is_active,
  last_login: r.last_login,
});

function checkRole(role: unknown): string {
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
    throw new HttpError(400, `Invalid role. Allowed: ${[...ALLOWED_ROLES].sort().join(", ")}`);
  }
  return role;
}

function checkName(name: unknown): string {
  const v = typeof name === "string" ? name.trim() : "";
  if (!v) throw new HttpError(422, "full_name is required");
  if (v.length > 255) throw new HttpError(422, "full_name is too long");
  return v;
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "The password must be at least 8 characters.");
  }
  return password;
}

const target = async (userId: number): Promise<Row> => {
  const row = await fetchrow(`SELECT ${COLUMNS}, auth_id FROM users WHERE id = $1`, [userId]);
  if (!row) throw new HttpError(404, "User not found");
  return row;
};

// Paths are "" and "/" so both `/platform/users` and `/platform/users/` match.
const list = async (c: any) => {
  const rows = await fetch(`SELECT ${COLUMNS} FROM users ORDER BY id ASC`);
  return c.json(rows.map(shape));
};
router.get("", list);
router.get("/", list);

const create = async (c: any) => {
  const body = await jsonBody(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw new HttpError(422, "A valid email is required");
  // No password = the person sets their own from the welcome email. One
  // that is given is still checked, and the welcome email then just says hello.
  const password = body.password ? checkPassword(body.password) : null;
  const fullName = checkName(body.full_name);
  const role = checkRole(body.role ?? "viewer");

  const existing = await fetchrow(`SELECT ${COLUMNS}, auth_id FROM users WHERE LOWER(email) = $1`, [email]);
  if (existing?.is_active) throw new HttpError(400, "User already exists");

  // Re-adding a deactivated email reactivates it with the new details — the
  // email is UNIQUE, so a second row could never be inserted anyway.
  let authId: string | null = existing?.auth_id ?? null;
  if (authId) {
    const { error } = await admin.auth.admin.updateUserById(authId, {
      ...(password ? { password } : {}),
      ban_duration: "none",
      email_confirm: true,
    });
    if (error) throw new HttpError(400, error.message);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      ...(password ? { password } : {}),
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create the login");
    authId = data.user.id;
  }

  const row = existing
    ? await fetchrow(
      `UPDATE users SET auth_id = $2, full_name = $3, role = $4, is_active = true, updated_at = NOW()
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [existing.id, authId, fullName, role],
    )
    : await fetchrow(
      `INSERT INTO users (auth_id, email, full_name, role) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [authId, email, fullName, role],
    );
  console.log("user_saved", { id: row!.id, role, reactivated: !!existing });

  // The welcome email carries a set-password link either way, so a login made
  // with a password can still pick their own. A failed send doesn't undo the
  // login: the admin is told, and can use "Send reset email" later.
  let emailed = false;
  try {
    await sendAuthMail("welcome", email, fullName, await recoveryLink(email));
    emailed = true;
  } catch (err) {
    console.error("welcome_mail_failed", { id: row!.id, error: String(err) });
  }
  return c.json({ ...shape(row!), emailed });
};
router.post("", create);
router.post("/", create);

/** Change a login's name, role or active flag. */
router.patch("/:id", async (c) => {
  const me = currentUser(c) as User;
  const id = intParam(c, "id");
  const user = await target(id);
  const body = await jsonBody(c);

  const sets: string[] = [];
  const params: any[] = [id];
  if ("full_name" in body) {
    params.push(checkName(body.full_name));
    sets.push(`full_name = $${params.length}`);
  }
  if ("role" in body) {
    const role = checkRole(body.role);
    if (id === me.id && role !== "super_admin") {
      throw new HttpError(400, "You can't take away your own admin role.");
    }
    params.push(role);
    sets.push(`role = $${params.length}`);
  }
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") throw new HttpError(422, "is_active must be true or false");
    if (id === me.id && !body.is_active) throw new HttpError(400, "Cannot deactivate yourself");
    params.push(body.is_active);
    sets.push(`is_active = $${params.length}`);
    if (user.auth_id) {
      await admin.auth.admin.updateUserById(user.auth_id, { ban_duration: body.is_active ? "none" : BANNED });
    }
  }
  if (!sets.length) return c.json(shape(user));

  const row = await fetchrow(
    `UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING ${COLUMNS}`,
    params,
  );
  return c.json(shape(row!));
});

/** Deactivate a login (nightingale's DELETE). */
router.delete("/:id", async (c) => {
  const me = currentUser(c);
  const id = intParam(c, "id");
  if (id === me.id) throw new HttpError(400, "Cannot deactivate yourself");
  const user = await target(id);
  await execute("UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1", [id]);
  if (user.auth_id) {
    await admin.auth.admin.updateUserById(user.auth_id, { ban_duration: BANNED });
  }
  console.log("user_deactivated", { id, admin_id: me.id });
  return c.json({ status: "success", message: `User ${id} deactivated` });
});

/**
 * Email the user a one-time link to set a new password — also how logins
 * copied over from nightingale (whose password hashes Supabase Auth cannot
 * read) set their first password here. The admin is not throttled, but when
 * the email can't be sent the link comes back instead, to pass on by hand.
 */
router.post("/:id/password-reset", async (c) => {
  const user = await target(intParam(c, "id"));
  if (!user.is_active) throw new HttpError(400, "Reactivate this login first.");
  if (!user.auth_id) throw new HttpError(400, "This login has no sign-in account yet.");
  let link: string;
  try {
    link = await recoveryLink(user.email);
  } catch (err) {
    throw new HttpError(400, `Could not create a reset link: ${String(err)}`);
  }
  try {
    await sendAuthMail("reset", user.email, user.full_name, link);
    return c.json({ status: "success", emailed: true, email: user.email });
  } catch (err) {
    console.error("reset_mail_failed", { id: user.id, error: String(err) });
    return c.json({ status: "success", emailed: false, email: user.email, link });
  }
});
