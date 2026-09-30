# Starforge Developer Portal

The developer platform for **Buildo**, Starforge Robotics' Physical AI robot.
Developers and researchers sign up, connect a wallet, try Buildo in a
browser-based physics simulator, and buy skills — paid for in $ credit.

Full-stack Next.js app (App Router) — one deployable unit for both the
frontend and the API.

**New here?** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local setup
that actually works today, the branch workflow, and the mistakes this repo
has already made once so you don't have to repeat them.

## What's live vs. simulated right now

| Feature | Status |
|---|---|
| Signup / login / logout | **Live.** Real auth (bcrypt + signed JWT session cookie), real Postgres-backed accounts. |
| Email verification, forgot/reset password | **Live.** Token-based flows, emailed via the same pipeline as the welcome email. |
| Welcome / verification emails | **Live.** Sends via Resend when `RESEND_API_KEY` is set; falls back to a free Ethereal test inbox (preview URL logged to console) otherwise. |
| Wallet connect | **Live.** Real browser wallet connection (MetaMask etc. via wagmi), address is linked to the account in the DB. |
| Credit balance | **Live, but off-chain.** A `tokenBalance` column in the DB — credited 20$ on first wallet connect, debited on skill purchase. This is a real ledger (`TokenTransaction` table), just not on-chain yet. |
| Skills marketplace | **Live.** Real DB transactions debit the token balance; no skill is actually deployed (there's no paired robot hardware yet). |
| Browser MuJoCo simulator (`/dashboard/simulate`) | **Live.** A real physics simulation (MuJoCo compiled to WASM, rendered with three.js) — drive the robot, run the scripted pick-and-place workflow. |
| Robot pairing / telemetry | **UI preview only** — no hardware integration yet. |
| Train on your own dataset | **UI only** — file picker works client-side, no upload/training pipeline yet. |
| On-chain ETH/token airdrop | **Not wired up yet, intentionally deferred.** See below. |
| GPU rental | **Removed.** Was scaffolded early on; cut because it never had a real backend and the UI misled people into thinking otherwise. The `GpuSession` DB model is still there (unused) — don't build on top of it without checking first. |

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4)
- **Prisma + Postgres** (hosted on Neon via Vercel; there is no SQLite fallback — the schema's datasource is hardcoded to `postgresql`)
- **Auth**: bcrypt password hashing + `jose`-signed JWT session cookie (no third-party auth service)
- **Wallet connect**: `wagmi` + `viem`, injected connector (MetaMask, Rabby, etc.)
- **Email**: Resend, with an Ethereal test-inbox fallback for local dev
- **Simulator**: MuJoCo (WASM build) + three.js, browser-side physics and rendering
- **Data fetching**: `@tanstack/react-query` on the client, direct Prisma queries in Server Components
- **Package manager**: **pnpm only** — see CONTRIBUTING.md before you reach for `npm install`

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL and AUTH_SECRET, see below
pnpm exec prisma migrate deploy
pnpm dev
```

Open http://localhost:3000. Sign up, verify the email (see below for how to
find it without real SMTP), then connect a wallet from the dashboard (needs
a browser extension wallet like MetaMask installed) to see the 20$ reward
credit.

No email provider setup is required to try this locally — without
`RESEND_API_KEY` set, the server logs a line like:

```
[mailer] Welcome email preview: https://ethereal.email/message/...
```

Open that link to see the actual email that was sent.

## Environment variables

See `.env.example` for the full list. Two are required to run locally:

- `DATABASE_URL` — a real Postgres connection string. [Neon](https://neon.tech)
  has a free tier and takes under a minute to get one from; ask in the team
  channel if you'd rather get a connection string to a shared dev database
  instead of creating your own.
- `AUTH_SECRET` — any long random string, generate your own with
  `openssl rand -base64 32`. **Don't reuse production's** — this only needs
  to be internally consistent for your own local sessions.

`RESEND_API_KEY` is optional (see "Getting started" above for the fallback).

## Deployment

This app deploys to **Vercel**, with Postgres on **Neon** (provisioned
through Vercel's integration). `main`/`master` pushes trigger a production
deploy automatically.

The one deploy failure this repo has already hit: Vercel's build only ever
reads `pnpm-lock.yaml`. If a dependency is ever added with `npm install`
instead of `pnpm install`, `package-lock.json` comes back, drifts out of
sync with `pnpm-lock.yaml`, and the next Vercel build fails with
`ERR_PNPM_OUTDATED_LOCKFILE` — confusing because it looks unrelated to
whatever was actually changed. There's a repo-root `.gitignore` guard for
this now; see CONTRIBUTING.md.

## Wiring up the real on-chain airdrop (future work)

The schema already has what's needed to plug this in without a data model
change:

- `TokenTransaction.txHash` and `.status` are already there, unused today —
  fill them in once a transaction is actually broadcast.
- The reward-crediting logic lives in `src/app/api/wallet/connect/route.ts`.
  Today it just increments `User.tokenBalance` in a DB transaction; the real
  version would additionally call an ERC-20 `transfer` from a treasury
  wallet to `User.walletAddress`, store the resulting `txHash`, and only
  mark the `TokenTransaction` `COMPLETED` once it confirms.
- Recommended path: deploy a simple ERC-20 on **Sepolia testnet** first
  (zero financial risk), get the flow working end-to-end, then move to
  mainnet with a funded treasury wallet. Keep `TREASURY_PRIVATE_KEY` out of
  the app entirely if possible — call out to a small signer service or use
  a secrets manager, never commit it or put it in a client-reachable env var.

## Project structure

```
prisma/schema.prisma           User, TokenTransaction, GpuSession (unused), SkillOrder
model/                         MuJoCo/URDF source assets + conversion scripts for the simulator
src/lib/auth.ts                session cookies, password hashing
src/lib/mailer.ts              welcome/verification emails
src/lib/web3-config.ts         wagmi chains/connectors
src/lib/constants.ts           skills catalog, reward amount
src/components/simulation/     the MuJoCo/three.js browser simulator
src/app/(marketing)/           landing, signup, login (public)
src/app/dashboard/             overview, robots, simulate, train, skills (auth-gated)
src/app/api/                   auth (signup/login/verify/reset), wallet/connect, skills/buy
src/proxy.ts                   route protection for /dashboard/* (Next 16's middleware convention)
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
