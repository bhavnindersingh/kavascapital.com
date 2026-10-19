# kavascapital.com

Two sites in one repo, each its own Netlify site:

| Folder | Site | What it is |
|---|---|---|
| `/` (root) | **kavascapital.com** | Public marketing site: Vite + React + Tailwind + three.js. Static, no backend. |
| `legal/` | **legal.kavascapital.com** | Partners' workspace (Tasks, Accounts, Documents, Users) on Supabase. See `legal/README.md`. |

The page layout and copy are in `src/LandingPage.tsx`; the live canvases (engine,
Quant Lab, returns chart, background) are in `src/components/`. Colours live in
`src/lib/palette.ts`, mirrored in `tailwind.config.js`; change both together.
Fonts are Cormorant Garamond (headings, figures), Inter (body) and JetBrains
Mono (live figures). It has no login.

## Local

```bash
npm install
npm run dev        # http://localhost:3001
npm run build      # → dist/
```

## Netlify: kavascapital.com

New site from this repo, **Base directory empty** (repo root). Build settings
come from `netlify.toml` (`npm run build`, publish `dist`, Node 20). No
environment variables. A push that only touches `legal/` skips this build.

Domain: add `kavascapital.com` and `www.kavascapital.com` in Netlify, then in
DNS point `@` at Netlify's load balancer (`A 75.2.60.5`) and
`CNAME www → <site>.netlify.app`, or use whatever records Netlify shows.

## Netlify: legal.kavascapital.com

Second site from the same repo, **Base directory `legal`**, `CNAME legal →
<site>.netlify.app`. Full steps, Supabase included, in `legal/README.md`.
