# Takes Two Studio — project context

Drop this file at the repo root. Claude Code reads it automatically at the start
of every session, so you don't have to re-explain the project each time.

---

## What this is

Portfolio site for Takes Two Studio, an advertising and food & beverage
photography studio based in Cairo with a Riyadh presence. Founded 2017 by
Mohamed Medhat and Ahmed Okasha.

Design reference: Lindsay Adler's portfolio site. Editorial, dark, image-first.

## Architecture (unusual — read carefully)

There are **two separate front ends** in this repo:

1. **The public site** is a single static file, `public/index.html` (~67 KB:
   inline CSS, inline vanilla JS, no build step). `src/app/page.tsx` is just a
   `redirect("/index.html")`. There is no React on the public site.
2. **The admin panel** is a Next.js App Router page, `src/app/admin/page.tsx`
   (~1,300 lines, shadcn/Radix). It talks to the routes under `src/app/api/`.

The `public/index.html` file fetches its content from those same API routes at
runtime. So a change to an API response shape can break the static site even
though nothing in `src/` references it. **Always grep `public/index.html` after
changing an API route.**

Stack: Next.js 16 · React 19 · Prisma 6 · SQLite · Tailwind 4 (admin) /
Tailwind CDN (public site, being removed) · sharp · bun.

Hosting: Hostinger Node.js app behind Caddy. `next start` on port 3000.

## Non-negotiables

**Never run bulk image or database analysis on the server.** The hosting is
shared and cannot absorb sustained image work: a script that decoded ~400
images in one unbatched loop starved the Node app until the API stopped
answering and SSH refused connections, and it took a redeploy to recover.

Do it on the local machine instead, against a copy of `~/studio-data` pulled
down over `scp`/`rsync`. If something genuinely must run on the server, do it
**one image at a time with a pause between**, and never in a single loop over
the whole library.

This applies to diagnostics as much as to features. The upload and regeneration
paths are already batched for exactly this reason — the same limit binds a
throwaway script, and a read-only script is not automatically a safe one.

**Image quality is the product.** This is a photography studio. Never
downsample a master, never re-encode an already-encoded derivative, and always
embed the sRGB ICC profile in output (`.withIccProfile('srgb')`). Use 4:4:4
chroma subsampling — the default 4:2:0 visibly smears saturated edges, which
matters on food and beverage work. Masters are stored untouched and never served.

**Secrets never enter the repo.** `ADMIN_PASSWORD`, `SESSION_SECRET`, and
`MEDIA_ROOT` live only in the Hostinger environment panel. Do not add them to
`.env`, `.env.example` values, comments, log lines, error messages, or test
fixtures. If you need a placeholder, use `ADMIN_PASSWORD=<set-in-hosting-panel>`.

**Uploads live outside the app directory.** `MEDIA_ROOT` points to a persistent
path. Never write user uploads into `public/` — a redeploy replaces that
directory and the images vanish.

**Every API route that mutates or reads private data checks auth.** Pattern:

```ts
import { checkAdmin, unauthorized } from "@/lib/auth";
if (!checkAdmin(req)) return unauthorized();
```

The only routes that are legitimately public: `GET /api/projects`,
`GET /api/overview`, `GET /api/settings`, `GET /api/media/*`,
`GET /api/icon/*` (favicons and the web manifest — fetched by the browser
before anything else, and they reveal nothing).

There is no public write route. `POST /api/inquiries` used to be one, backing
the contact form; both were removed. Every remaining route that mutates
anything checks auth.

## Conventions

- Route handlers return `NextResponse.json(...)`, errors as `{ error: string }`.
- Prisma client is the singleton from `@/lib/db` — never `new PrismaClient()`
  inside a route.
- In `public/index.html`, text goes through `escapeHtml()` and **attributes
  through `escapeAttr()`**. Never interpolate a URL into an attribute raw.
- Don't add dependencies without asking. `next-auth` and `z-ai-web-dev-sdk` are
  currently installed and unused — they should be removed, not built on.

## Commands

```bash
bun install
bun run dev              # localhost:3000
bun run build            # prisma generate && next build
bun run lint
bunx tsc --noEmit        # type check — CI does not do this yet, see below
```

## Known state

`next.config.ts` currently sets `typescript.ignoreBuildErrors: true`, so type
errors are invisible at build time. When that flag comes off, expect a batch of
errors in `src/app/admin/page.tsx`. Fix them; do not re-enable the flag.

`reactStrictMode: false` is also set. Leave it for now — turning it on may
surface double-render bugs in the admin drag-and-drop code, which is a separate
piece of work.
