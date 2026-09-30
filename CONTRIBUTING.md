# Contributing

Welcome. This covers local setup, the rules that exist because we already
got burned once, and the branch workflow. If something here is out of date,
fix it in the same PR that made it wrong — this file rots fast otherwise.

## Setup

This is a Turborepo/pnpm-workspaces monorepo (`apps/`, `packages/`,
`services/` — see the root README's "Layout" section). The app itself lives
in `apps/portal`; run installs/dev/build from the repo root, but env files
and Prisma commands are scoped to `apps/portal`.

```bash
pnpm install
cd apps/portal && cp .env.example .env.local
cd ../..
pnpm exec prisma migrate deploy --filter @buildo/portal   # or: cd apps/portal && pnpm exec prisma migrate deploy
pnpm dev
```

You need two things in `apps/portal/.env.local` before this works:

- **`DATABASE_URL`** — a real Postgres connection string. The schema's
  datasource is hardcoded to `postgresql`; there's no SQLite fallback, so
  this can't be skipped. [Neon](https://neon.tech)'s free tier takes under
  a minute to set up and gives you your own isolated dev database (recommended
  — don't point your local dev at the shared production database). Ask in
  the team channel if you'd rather be added to a shared dev database instead.
- **`AUTH_SECRET`** — any long random string:
  ```bash
  openssl rand -base64 32
  ```
  Generate your own. Don't copy production's, and don't ask for it —
  session secrets are meant to differ per environment; reusing one doesn't
  buy you anything and just widens the blast radius if one leaks.

`RESEND_API_KEY` is optional. Without it, the app sends real emails through
a free Ethereal test inbox and logs the preview link to the console — that's
enough to test signup/verification/password-reset locally.

## The one rule that actually matters: pnpm only

**Never run `npm install` in this repo.** Ever, even once, even to "just
quickly add one package."

Here's why this is called out this aggressively: it already broke
production once. Someone ran `npm install some-package`, which regenerated
`package-lock.json` locally while leaving `pnpm-lock.yaml` untouched. That
got committed. Vercel's build only reads `pnpm-lock.yaml` — it had no idea a
new dependency existed, tried to build against the old lockfile, and failed
with `ERR_PNPM_OUTDATED_LOCKFILE`. The error message doesn't mention
`package-lock.json` at all, so whoever's debugging it has no obvious lead —
expect to lose real time here if it happens again.

If you ever see a `package-lock.json` show up in `git status`, that's the
bug already happening — delete it and regenerate `pnpm-lock.yaml` instead:

```bash
rm package-lock.json
pnpm install
```

To add a dependency, always:

```bash
pnpm add some-package
```

## Branch workflow

```
feature branch  →  dev  →  master
```

- New work (features, fixes, experiments) branches off `dev`, not `master`.
- `dev` is the integration branch — things get merged there first and
  tested together before going anywhere near production.
- `master` is production. Pushing to it deploys automatically (Vercel).
  Don't merge a feature branch straight into `master`.
- Docs-only changes (like this file) are low-risk enough to go straight to
  `master` if that's more convenient — use judgment, the dev-first rule
  exists to protect against untested *code* reaching production, not to
  make every single change bureaucratic.

If you're touching the browser MuJoCo simulator specifically
(`apps/portal/src/components/simulation/`, `packages/buildo-mujoco/`): that
code took real, expensive iteration to get right (grip physics, collision
tuning, the pick-and-place choreography). Before merging anything that
touches it, manually re-run the full workflow in `/dashboard/simulate` and
confirm nothing regressed — there isn't automated test coverage for
simulator behavior yet, so this is the only check that exists.

## Commit hygiene

Group commits by logical change, not by "everything I did today in one
lump." If you touched three unrelated things, that's three commits. It
makes `git blame`/`git log` actually useful later, and makes a bad change
easy to revert without taking unrelated ones down with it.

## Environment files

`Next.js` loads both `.env` and `.env.local`. The Prisma CLI (`prisma
migrate deploy`, etc.) only auto-loads `.env`, not `.env.local` — if a
Prisma command can't find `DATABASE_URL` even though your app runs fine,
that's why. Either export the var yourself for that one command, or keep a
`.env` in sync with `.env.local`.

Never commit real secrets. `.env` and `.env.local` are both gitignored —
keep it that way.
