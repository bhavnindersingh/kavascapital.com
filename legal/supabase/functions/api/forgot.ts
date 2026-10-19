/**
 * "Forgot password?" — the one route that takes no login.
 *
 * It answers the same sentence whatever happens: no such login, a deactivated
 * one, too many requests, or Resend down. Anything else would let a stranger
 * find out which emails have accounts here. The real outcome goes to the log.
 */
import { Hono } from "npm:hono@4.6.14";
import { fetchrow } from "./_lib/db.ts";
import { jsonBody } from "./_lib/http.ts";
import { recoveryLink, sendAuthMail, throttled } from "./_lib/mail.ts";

export const router = new Hono();

const SENT = { status: "sent", detail: "If that email has a login here, a reset link is on its way." };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/forgot", async (c) => {
  const body = await jsonBody(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 255) return c.json(SENT);

  const user = await fetchrow(
    "SELECT email, full_name FROM users WHERE LOWER(email) = $1 AND is_active AND auth_id IS NOT NULL",
    [email],
  );
  if (!user) {
    console.log("forgot_no_login", { email });
    return c.json(SENT);
  }
  if (await throttled(user.email)) {
    console.log("forgot_throttled", { email });
    return c.json(SENT);
  }
  try {
    await sendAuthMail("reset", user.email, user.full_name, await recoveryLink(user.email));
  } catch (err) {
    console.error("forgot_send_failed", { email, error: String(err) });
  }
  return c.json(SENT);
});
