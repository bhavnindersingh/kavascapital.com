/**
 * Platform session endpoints. Port of nightingale's `api/platform_auth.py`.
 *
 * Signing in itself is Supabase Auth's (the browser calls signInWithPassword
 * and holds the session); there is no login route here any more. What stays is
 * `/me` — the page's "who am I", which also stamps `last_login` — and
 * `/logout`, kept so the client has one call to make on the way out.
 */
import { Hono } from "npm:hono@4.6.14";
import { currentUser, type Env } from "./_lib/auth.ts";
import { execute } from "./_lib/db.ts";
import { sendAuthMail, throttled } from "./_lib/mail.ts";

export const router = new Hono<Env>();

router.get("/me", async (c) => {
  const user = currentUser(c);
  await execute("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);
  return c.json({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  });
});

router.post("/logout", (c) => c.json({ status: "success" }));

/**
 * Called by the reset page once a new password is set, so the owner of the
 * login hears about it — the one email that tells someone a reset they didn't
 * ask for went through. Best effort: the password is already changed.
 */
router.post("/password-changed", async (c) => {
  const user = currentUser(c);
  try {
    if (await throttled(user.email)) return c.json({ status: "success" });
    await sendAuthMail("password_changed", user.email, user.full_name);
  } catch (err) {
    console.error("password_changed_mail_failed", { id: user.id, error: String(err) });
  }
  return c.json({ status: "success" });
});
