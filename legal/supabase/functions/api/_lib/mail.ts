/**
 * Sign-in email: password reset, welcome, password changed. Sent through
 * Resend (RESEND_API_KEY), from EMAIL_FROM on the verified
 * kavasconsultancy.com domain.
 *
 * THE LINK NEVER CARRIES A SESSION. Supabase's own recovery link
 * (/auth/v1/verify) spends its token the moment anything opens it, and mail
 * security scanners (Outlook Safe Links, Gmail's) open every link in an email
 * before the person does — so the person clicks a link that is already dead.
 * Instead the email points at our own page with the token's hash
 * (`/reset-password?token_hash=…`), and the token is only spent when the person
 * presses "Set password" (supabase.auth.verifyOtp on the page).
 */
import { admin } from "./auth.ts";
import { execute, fetchval } from "./db.ts";

export type MailKind = "reset" | "welcome" | "password_changed";

const SITE_URL = () => Deno.env.get("SITE_URL") ?? "https://legal.kavascapital.com";
const FROM = () => Deno.env.get("EMAIL_FROM") ?? "Kavas Legal <no-reply@kavasconsultancy.com>";

// Per address: at most one email a minute and five an hour, across kinds.
const PER_MINUTE = 1;
const PER_HOUR = 5;

/** True when `email` has had too many sign-in emails lately. */
export async function throttled(email: string): Promise<boolean> {
  const minute = await fetchval(
    "SELECT COUNT(*)::int FROM auth_mail_log WHERE email = $1 AND created_at > NOW() - INTERVAL '1 minute'",
    [email],
  );
  if (minute >= PER_MINUTE) return true;
  const hour = await fetchval(
    "SELECT COUNT(*)::int FROM auth_mail_log WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'",
    [email],
  );
  return hour >= PER_HOUR;
}

/**
 * A one-time link to set a password, on our own page. Valid for as long as the
 * project's recovery-link lifetime (an hour by default).
 */
export async function recoveryLink(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error(`generateLink failed: ${error?.message ?? "no token"}`);
  return `${SITE_URL()}/reset-password?token_hash=${encodeURIComponent(hash)}&type=recovery`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** One email layout for all three: a mark, a heading, a paragraph, one button. */
function layout(o: { preheader: string; heading: string; body: string; button?: { label: string; href: string }; footnote: string }): string {
  const button = o.button
    ? `<tr><td style="padding:8px 0 28px">
         <a href="${esc(o.button.href)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.04em;padding:13px 26px;border-radius:6px">${esc(o.button.label)}</a>
       </td></tr>
       <tr><td style="padding:0 0 24px;font-size:12px;line-height:18px;color:#737373">
         Button not working? Paste this into your browser:<br>
         <a href="${esc(o.button.href)}" style="color:#525252;word-break:break-all">${esc(o.button.href)}</a>
       </td></tr>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0a0a">
<span style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e5e5;border-radius:10px">
    <tr><td style="padding:32px 32px 0">
      <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Kavas Capital <span style="color:#737373;font-weight:500">· Legal</span></div>
    </td></tr>
    <tr><td style="padding:24px 32px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 12px;font-size:22px;line-height:28px;font-weight:700;letter-spacing:-.01em">${esc(o.heading)}</td></tr>
        <tr><td style="padding:0 0 24px;font-size:15px;line-height:23px;color:#404040">${o.body}</td></tr>
        ${button}
      </table>
    </td></tr>
    <tr><td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;font-size:12px;line-height:18px;color:#a3a3a3">${esc(o.footnote)}</td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function render(kind: MailKind, name: string, link?: string): { subject: string; html: string; text: string } {
  const first = esc((name || "there").split(" ")[0]);
  if (kind === "reset") {
    return {
      subject: "Reset your Kavas Legal password",
      html: layout({
        preheader: "Set a new password — the link works once, for an hour.",
        heading: "Reset your password",
        body: `Hi ${first}, someone asked to reset the password for your Kavas Legal login. Choose a new one below. The link works once and expires in an hour.`,
        button: { label: "Set a new password", href: link! },
        footnote: "Didn't ask for this? Ignore this email — your password stays as it is.",
      }),
      text: `Hi ${name || "there"},\n\nReset your Kavas Legal password here (works once, expires in an hour):\n${link}\n\nDidn't ask for this? Ignore this email — your password stays as it is.`,
    };
  }
  if (kind === "welcome") {
    return {
      subject: "Your Kavas Legal login is ready",
      html: layout({
        preheader: "Set your password to sign in to legal.kavascapital.com.",
        heading: "Welcome to Kavas Legal",
        body: `Hi ${first}, a login has been made for you on Kavas Legal — the partners' tasks, accounts and documents. Set your password to sign in. The link works once and expires in an hour; after that, use "Forgot password?" on the sign-in page.`,
        button: { label: "Set your password", href: link! },
        footnote: "Weren't expecting this? You can ignore this email.",
      }),
      text: `Hi ${name || "there"},\n\nA Kavas Legal login has been made for you. Set your password here (works once, expires in an hour):\n${link}`,
    };
  }
  const when = new Date().toUTCString();
  return {
    subject: "Your Kavas Legal password was changed",
    html: layout({
      preheader: "Your password was just changed.",
      heading: "Password changed",
      body: `Hi ${first}, the password for your Kavas Legal login was changed on ${esc(when)}.`,
      button: { label: "Sign in", href: `${SITE_URL()}/login` },
      footnote: `Wasn't you? Reset it now from "Forgot password?" on the sign-in page, and tell the other partner.`,
    }),
    text: `Hi ${name || "there"},\n\nThe password for your Kavas Legal login was changed on ${when}.\n\nWasn't you? Reset it now: ${SITE_URL()}/login`,
  };
}

/**
 * Send one sign-in email and log it for the throttle. Throws when Resend
 * refuses, so a caller that must not fail silently (the admin's button) can
 * say so; the public forgot form swallows it.
 */
export async function sendAuthMail(kind: MailKind, to: string, name: string, link?: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, html, text } = render(kind, name, link);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM(), to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  await execute("INSERT INTO auth_mail_log (email, kind) VALUES ($1, $2)", [to, kind]);
  console.log("auth_mail_sent", { kind, to });
}
