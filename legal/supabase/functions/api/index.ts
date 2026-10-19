/**
 * legal.kavascapital.com API — one edge function, nightingale's routes.
 *
 * The routes are nightingale's FastAPI `/api/platform/...` routes under the
 * same paths, so the pages ported from nightingale call them unchanged:
 *
 *   https://<project>.supabase.co/functions/v1/api/platform/tasks/...
 *
 * Each feature module exports a Hono router that is mounted here; every route
 * below `/platform` requires a signed-in, active login (`requireUser`), and the
 * modules add their own gates (partners only, task roles, admin).
 */
import { Hono } from "npm:hono@4.6.14";
import { cors } from "npm:hono@4.6.14/cors";
import { requireUser, type Env } from "./_lib/auth.ts";
import { HttpError } from "./_lib/http.ts";
import { router as auth } from "./auth.ts";
import { router as forgot } from "./forgot.ts";
import { router as users } from "./users.ts";
import { router as tasks } from "./tasks.ts";
import { router as accounts } from "./accounts.ts";
import { router as documents } from "./documents.ts";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://legal.kavascapital.com,http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = new Hono<Env>().basePath("/api");

app.use(
  "*",
  cors({
    // An unknown origin is answered with our own, which the browser rejects.
    // Never `null`: a sandboxed iframe or file:// page sends Origin: null.
    origin: (origin) => (ORIGINS.includes(origin) ? origin : ORIGINS[0]),
    allowHeaders: ["authorization", "x-client-info", "apikey", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 600,
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

// Public: "Forgot password?" happens before anyone is signed in.
app.route("/auth", forgot);

app.use("/platform/*", requireUser);
app.route("/platform/auth", auth);
app.route("/platform/users", users);
app.route("/platform/tasks", tasks);
app.route("/platform/accounts", accounts);
app.route("/platform/documents", documents);

app.notFound((c) => c.json({ detail: "Not Found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail }, err.status as any);
  }
  console.error("unhandled", err);
  return c.json({ detail: "Internal server error" }, 500);
});

Deno.serve(app.fetch);
