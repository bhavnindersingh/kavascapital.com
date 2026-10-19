# legal.kavascapital.com

The partners' workspace — **Tasks**, **Accounts**, **Documents** and **Users** —
moved off the nightingale trading stack (2026-10-18). Behaviour is
nightingale's; see its `docs/us-port/US_PORT_FINDINGS_AND_PLAN.md` §8, §18, §19.

| Piece | Where |
|---|---|
| Frontend (Vite + React) | `src/`, deployed on **Netlify**, base directory `legal` |
| Database, auth, files | **Supabase** project `jgljyprtjtndujujdvuy` |
| Schema | `supabase/migrations/` |
| API | one edge function, `supabase/functions/api/` — nightingale's `/platform/...` routes |
| Data copy from nightingale | `scripts/migrate-from-nightingale.ts` |

Every table has RLS on and no policies, and the three buckets (`tasks`,
`accounts`, `documents`) are private: only the `api` function reads or writes
them. Accounts and Documents are open to the partners' emails only
(`ACCOUNTS_ALLOWED_EMAILS`), whatever their role.

## Deploy

```bash
cd legal
supabase link --project-ref jgljyprtjtndujujdvuy
supabase db push                       # tables + buckets
supabase secrets set ALLOWED_ORIGINS=https://legal.kavascapital.com \
                     SITE_URL=https://legal.kavascapital.com \
                     RESEND_API_KEY=re_… \
                     "EMAIL_FROM=Kavas Legal <no-reply@kavasconsultancy.com>"
# optional, defaults to the two partners:
# supabase secrets set ACCOUNTS_ALLOWED_EMAILS=a@x.com,b@y.com
supabase functions deploy api --no-verify-jwt
```

In the Supabase dashboard → Authentication → URL configuration, set the site
URL to `https://legal.kavascapital.com` and add
`https://legal.kavascapital.com/reset-password` as a redirect URL. Turn off
public sign-ups (logins are made on the Users page).

Netlify: new site from this repo, **Base directory `legal`** (build settings
come from `netlify.toml`), env vars `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (the project's publishable key). Add the domain
`legal.kavascapital.com` and a DNS record `CNAME legal → <site>.netlify.app`.

## Password email

All sign-in email goes through Resend from the `api` function (not Supabase
Auth's mailer): **Forgot password?** on the sign-in page, **Send reset email**
on the Users page, a **welcome** email when a login is created (leave the
password blank and they set their own), and a **password changed** notice.
Links point at `/reset-password?token_hash=…` and are spent only when the form
is submitted, so mail scanners can't burn them; they work once, for an hour.
At most one email per address a minute and five an hour (`auth_mail_log`).
The sender must be on a domain verified in Resend — today that is
`kavasconsultancy.com`; verify `kavascapital.com` there to send from it.

## Moving the data

Once, after `db push` and before anyone uses the app. It only reads
nightingale and refuses a project that already has rows.

Only two logins come across, as admins: nightingale's
`bhavnindersingh@gmail.com` → `bhavninder@kavasconsultancy.com` and
`rahulbhayana10@gmail.com` → `rahul@kavasconsultancy.com` (`KEEP_USERS` in the
script). Ledger entries move to the new emails; tasks, comments and files that
named anyone else keep their content and lose the name.

```bash
scp -r -i kavas-us.pem ubuntu@54.153.24.106:/opt/kavas-us/backend/uploads ./nightingale-uploads
SOURCE_DATABASE_URL=…  TARGET_DATABASE_URL=…  SUPABASE_URL=https://jgljyprtjtndujujdvuy.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=…  UPLOADS_DIR=./nightingale-uploads  INITIAL_PASSWORD=… \
deno run -A --node-modules-dir=none scripts/migrate-from-nightingale.ts --dry-run   # counts only
deno run -A --node-modules-dir=none scripts/migrate-from-nightingale.ts --links     # copy + one-time password links
```

`TARGET_DATABASE_URL` is the project's connection string (dashboard → Connect).
The direct `db.<ref>.supabase.co` host is IPv6-only; if it can't be reached,
use the **Session pooler** string instead.

Passwords do not carry over (nightingale's pbkdf2 hashes can't be read by
Supabase Auth): send each person their link, or use **Reset link** on the Users
page later.

## Local

```bash
supabase start                          # ports 5434x
supabase functions serve api --no-verify-jwt --env-file supabase/.env.local
npm install && npm run dev              # http://localhost:3000
```
