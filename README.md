# Higgsfield clone

A generative-media SaaS. Users sign in and can:

- **Generate videos** from a prompt with a choice of model, duration, resolution,
  aspect ratio, start/end frames and reference frames.
- **Generate images** from a prompt with a choice of model, resolution, aspect
  ratio and optional reference images.
- **Face swap** — upload a base image and a face, and get the face swapped in.
<img width="1002" height="702" alt="image" src="https://github.com/user-attachments/assets/45c9a136-51e3-44a7-9272-21b82eaecc41" />

Video and image generation are routed through
[OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/video-generation);
face swaps run on a self-hosted [FaceFusion](https://docs.facefusion.io) service.
All generated media and uploaded inputs are stored in an S3-compatible object
store (MinIO).

## Architecture

This is a [Turborepo](https://turborepo.dev) monorepo managed with **bun**.

| Path                         | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `apps/frontend`              | React + Vite + TypeScript SPA (Tailwind v4 + shadcn-style UI).             |
| `apps/backend`               | TypeScript + Express API. Auth (better-auth), OpenRouter + MinIO services. |
| `packages/db`                | Prisma schema + client. Shared Postgres data layer reused by the backend.  |
| `packages/typescript-config` | Shared `tsconfig` presets.                                                 |
| `packages/eslint-config`     | Shared ESLint config.                                                      |

Services (via `docker-compose.yml`):

- **Postgres** — primary database (Prisma).
- **MinIO** — local S3-compatible object store for videos, images & face swaps.
- **FaceFusion** — self-hosted face-swap HTTP service (`infra/facefusion`, behind a compose profile).
- **backend** / **frontend** — the application containers.

## Prerequisites

- [Docker](https://www.docker.com/) + Docker Compose
- [bun](https://bun.sh) `>= 1.3` (for local, non-Docker development)

## Quick start (everything in Docker)

```sh
# 1. Configure environment
cp .env.example .env
# (optional) add OPENROUTER_API_KEY and Google OAuth creds when you have them

# 2. Build & start the full stack
bun run docker:up        # docker compose up -d --build

# 3. Tail logs
bun run docker:logs
```

Once up:

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000 (health check at `/health`)
- MinIO console: http://localhost:9001 (user/pass from `.env`, default `minioadmin`)

Database migrations are applied automatically when the backend container starts.

Stop everything:

```sh
bun run docker:down          # stop containers
bun run docker:reset         # stop AND delete volumes (wipes DB + objects)
```

### Face swap (FaceFusion)

Face swapping requires the self-hosted FaceFusion service, which is **not started
by default** (the image is ~5GB and downloads models on first use). Start it with:

```sh
bun run docker:facefusion
# = docker compose --profile facefusion up -d --build facefusion
```

It exposes a small HTTP wrapper (`infra/facefusion`) around FaceFusion's
`headless-run` CLI at `http://localhost:7865/swap`. The backend reaches it via
the `FACEFUSION_URL` env var.

On first boot the container **pre-downloads the FaceFusion models** (lite scope,
which includes the face swapper) into the `facefusion_data` volume, so the models
persist across restarts and the first swap isn't slow. This initial download
takes a few minutes — the service reports healthy (and swaps work) once it
finishes. Subsequent starts skip the download via a marker file.

## Local development (apps on host, infra in Docker)

Run only Postgres + MinIO in Docker, and the apps on your machine with hot reload:

```sh
# 1. Start infra
bun run infra:up

# 2. Install deps
bun install

# 3. Configure per-app env
cp packages/db/.env.example packages/db/.env
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
#   -> set BETTER_AUTH_SECRET in apps/backend/.env

# 4. Set up the database
bun run db:generate
bun run db:push          # sync schema -> Postgres (use db:migrate once you add migrations)

# 5. Run all apps with hot reload
bun run dev
```

- Frontend dev server: http://localhost:5173
- Backend dev server: http://localhost:4000

## Environment variables

Secrets such as `OPENROUTER_API_KEY` and the Google OAuth client id/secret are
**provided later** — until then the app runs, but model listing and video
generation will return errors, and Google sign-in is hidden/disabled. See the
`.env.example` files:

- `.env.example` (root) — docker-compose variables
- `apps/backend/.env.example`
- `apps/frontend/.env.example`
- `packages/db/.env.example`

For Google OAuth, set the authorized redirect URI to:

```
http://localhost:4000/api/auth/callback/google
```

## Useful scripts

| Command                     | Description                                     |
| --------------------------- | ----------------------------------------------- |
| `bun run docker:up`         | Build & start the full stack in Docker.         |
| `bun run docker:down`       | Stop the stack.                                 |
| `bun run docker:reset`      | Stop the stack and delete volumes.              |
| `bun run docker:facefusion` | Build & start the FaceFusion face-swap service. |
| `bun run infra:up`          | Start only Postgres + MinIO.                    |
| `bun run dev`               | Run all apps locally with hot reload.           |
| `bun run build`             | Build all apps & packages.                      |
| `bun run check-types`       | Type-check the whole monorepo.                  |
| `bun run db:migrate`        | Run Prisma migrations.                          |
| `bun run db:studio`         | Open Prisma Studio.                             |
