# Buildo

Monorepo for the Buildo developer platform (Starforge Robotics) — see
`Buildo_MuJoCo_Developer_to_AppStore_Architecture_With_Simulation.pdf` at
the repo root for the target architecture this is being built toward.

## Layout

```
apps/
  portal/            The developer portal (Next.js) -- auth, dashboard,
                      browser MuJoCo simulator, skills marketplace.
packages/
  buildo-schema/      BuildoObservation/BuildoActionChunk wire schema --
                      the one contract every other piece builds against.
                      See packages/buildo-schema/README.md.
services/             (empty for now) Policy server, WebRTC signaling --
                      added as later phases land.
```

## Working in this repo

```bash
pnpm install
cd apps/portal && cp .env.example .env.local   # fill in real values
cd ../..
pnpm dev          # runs apps/portal via Turborepo
pnpm build        # builds all packages
pnpm typecheck    # typechecks all packages
```

Each package/app also has its own `README.md` with more detail
(`apps/portal/README.md`, `packages/buildo-schema/README.md`).

## Branching

`dev` is the integration branch — feature branches merge into `dev` and get
tested there before `dev` merges into `master`. Don't merge straight into
`master`.
