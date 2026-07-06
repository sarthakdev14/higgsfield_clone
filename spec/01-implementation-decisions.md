# 01 — Implementation Decisions & What We Built

This document captures the concrete decisions made (and the packages/services added)
while implementing [`00-initial-video-app.md`](./00-initial-video-app.md). It is the
record of "how" we built Step 1 (infra) and Step 2 (features), and the rationale
behind each choice.

---

## 1. Tech stack decisions

These were the key choices confirmed before implementation:

| Area              | Decision                          | Why                                                                    |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------- |
| Frontend scaffold | **Vite + React + TypeScript** (SPA) | Spec asked for a React frontend with a separate Express backend.       |
| Auth              | **better-auth**                   | Modern TS auth, native email/password + Google OAuth, Prisma adapter.  |
| Styling           | **Tailwind v4 + shadcn-style UI** | Fast, modern; components hand-built in `apps/frontend/src/components/ui`. |
| Runtime / PM      | **bun** everywhere                | Repo is already a bun-managed Turborepo; backend runs on bun directly. |

### Other notable decisions

- **Backend runs on bun, no build step.** `bun src/index.ts` runs TypeScript
  natively and resolves the `@repo/db` workspace package + `@prisma/client`. This
  avoids the complexity of compiling cross-package TS into `dist/`. `build` and
  `check-types` are just `tsc --noEmit`.
- **NodeNext + `.js` import specifiers** in the backend (e.g. `import { env } from "./env.js"`).
  TypeScript requires this; bun resolves the `.js` specifier to the `.ts` source.
- **OpenRouter "synchronously"** = submit the job, then **poll** the polling URL
  inside the request handler until it reaches a terminal state, then download the
  result. (OpenRouter video generation is inherently async; there is no background
  queue/worker yet — that can come later.)
- **Uploaded frames are sent to OpenRouter as base64 data URLs**, not MinIO URLs,
  because local MinIO is not publicly reachable by OpenRouter. The original images
  are still stored in MinIO to satisfy "all uploaded images are dumped to our object store".
- **Presigned URLs** (1h expiry) are returned by the API for stored videos/images
  instead of exposing MinIO directly.
- **FaceFusion is added but not started by default** — it sits behind a docker-compose
  `facefusion` profile because the image is large (~5GB) and it isn't needed yet.
- **`prisma db push` on container startup** (not `migrate deploy`) because there is
  no migration history yet. Switch to `migrate deploy` once migrations are committed.
- **Google sign-in is conditional** — the social provider is only registered when
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are present, so the app runs fine
  before those secrets are provided.

---

## 2. Monorepo layout

```
apps/
  backend/        Express + TS API (runs on bun)
  frontend/       Vite + React + TS SPA (Tailwind v4 + shadcn-style UI)
packages/
  db/             Prisma schema + shared client (@repo/db)
  eslint-config/  (existing) shared ESLint config
  typescript-config/ (existing) shared tsconfig presets
```

> The original `create-turbo` starter apps (`apps/web`, `apps/docs`, `packages/ui`)
> are removed — replaced by the real apps above.

---

## 3. Packages / dependencies added

### `packages/db`
- `@prisma/client`, `prisma` — ORM + client.
- `@types/node` — for `process` typing.

### `apps/backend`
- `express@4` — HTTP server (v4 for stable `*` wildcard routing with better-auth).
- `better-auth` — authentication (email/password + Google), `prismaAdapter`.
- `minio` — S3-compatible object-store client.
- `multer@1.4.5-lts` — multipart/form-data file uploads (frames).
- `zod` — env validation + request body validation.
- `cors`, `dotenv`.
- Dev: `@types/*`, `eslint`, `typescript`.

### `apps/frontend`
- `react`, `react-dom`, `react-router-dom` — UI + routing (`/`, `/login`).
- `better-auth` — `createAuthClient` from `better-auth/react`.
- `@radix-ui/react-{dialog,tabs,label,select,slot}` — primitives for shadcn-style UI.
- `class-variance-authority`, `clsx`, `tailwind-merge` — styling helpers (`cn`).
- `lucide-react` — icons.
- `tailwindcss@4` + `@tailwindcss/vite` — styling.
- Dev: `vite`, `@vitejs/plugin-react`, `@types/*`, `eslint`, `typescript`.

---

## 4. Database schema (`packages/db/prisma/schema.prisma`)

- **Auth models** matching better-auth's Prisma adapter: `User`, `Session`,
  `Account`, `Verification` (mapped to `user`/`session`/`account`/`verification`).
- **`Video`** model + **`VideoStatus`** enum (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`):
  - Generation params: `prompt`, `model`, `duration?`, `resolution?`, `aspectRatio?`.
  - Object-store keys: `startFrameKey?`, `endFrameKey?`, `referenceFrameKeys[]`, `videoKey?`.
  - OpenRouter bookkeeping: `providerJobId?`, `cost?`, `error?`.
  - `userId` relation to `User`, indexed.

---

## 5. Backend API surface

| Method & path                 | Auth | Description                                                    |
| ----------------------------- | ---- | ------------------------------------------------------------- |
| `ALL /api/auth/*`             | —    | better-auth handler (sign-up/in/out, Google, session).        |
| `GET /health`                 | —    | Liveness check.                                               |
| `GET /api/models`             | ✅   | Lists OpenRouter video models.                                |
| `GET /api/videos`             | ✅   | Current user's videos (with presigned URLs).                  |
| `GET /api/videos/:id`         | ✅   | Single video owned by the user.                               |
| `POST /api/videos`            | ✅   | Upload frames → call OpenRouter (sync) → store output.        |

Key files:
- `src/env.ts` — zod-validated env (fails fast on misconfig).
- `src/auth.ts` — better-auth config (email/password + conditional Google).
- `src/middleware/requireAuth.ts` — rejects unauthenticated requests, attaches `userId`.
- `src/lib/openrouter.ts` — submit + poll + download.
- `src/lib/storage.ts` — bucket bootstrap, upload, presign, download.
- `src/routes/{videos,models}.ts`.

The better-auth handler is mounted **before** `express.json()` (required), and CORS
is configured with `credentials: true` against `FRONTEND_URL`.

---

## 6. Frontend structure

- `App.tsx` — router: `/` (VideoPage), `/login` (LoginPage); `Navbar` always present.
- `components/Navbar.tsx` — single **Video** tab on the left; sign-in button or
  profile + sign-out on the right.
- `components/AuthForm.tsx` — shared email/password + Google form (sign-in/sign-up toggle).
- `components/AuthModal.tsx` — wraps `AuthForm` in a dialog (triggered from navbar).
- `pages/LoginPage.tsx` — standalone login page wrapping `AuthForm`.
- `pages/VideoPage.tsx` — two tabs:
  - **Text to Video** (`components/TextToVideoForm.tsx`): model, prompt, duration,
    resolution, aspect ratio, start/end frame, reference frames (optional ones optional).
  - **My Videos** (`components/MyVideos.tsx`): grid of the user's videos with status + playback.
- `components/SignedOut.tsx` — landing CTA for unauthenticated users.
- `lib/auth-client.ts` — better-auth React client. `lib/api.ts` — fetch wrappers
  (`credentials: "include"`). `lib/utils.ts` — `cn` helper.
- `components/ui/*` — shadcn-style Button, Input, Textarea, Label, Card, Dialog,
  Tabs, Select.

---

## 7. Infrastructure & tooling

### `docker-compose.yml` services
- `postgres` (16-alpine) — healthcheck + volume.
- `minio` — S3 API `:9000`, console `:9001`, volume, healthcheck.
- `backend` — built from `apps/backend/Dockerfile`; runs `prisma db push` then starts.
- `frontend` — built from `apps/frontend/Dockerfile`; static build served by nginx (`:5173`→80).
- `facefusion` — `facefusion/facefusion:3.6.1-cpu`, **profile `facefusion`**, UI `:7865`.

### Dockerfiles
- Backend: `oven/bun` base, monorepo-aware install, `prisma generate`, runs on bun.
- Frontend: `oven/bun` build stage → `nginx:alpine` runtime with SPA fallback (`nginx.conf`).

> Both Dockerfiles expect the **build context = repo root** (set in compose).

### Root `package.json` scripts
- `docker:up` / `docker:down` / `docker:logs` / `docker:reset` (reset wipes volumes).
- `infra:up` — Postgres + MinIO only (for host-based dev).
- `db:generate` / `db:migrate` / `db:push` / `db:studio`.

### Env files (`.env.example`)
- Root (docker-compose vars), `apps/backend`, `apps/frontend`, `packages/db`.
- Secrets left blank (provided later): `OPENROUTER_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`.
- Google OAuth redirect URI: `http://localhost:4000/api/auth/callback/google`.

### Docs
- `README.md` rewritten with Docker quickstart + host-based dev instructions.
- `AGENTS.md` added with conventions, commands, and verification steps.

---

## 8. Verification performed

- `bun run check-types`, `bun run build`, `bun run lint` — all green.
- `docker compose config` valid.
- Live boot against real Postgres + MinIO: bucket auto-created; `/health` OK;
  unauthenticated `/api/videos` → 401; email sign-up created a user + session;
  authenticated `/api/videos` → `[]`; `/api/models` returned the live OpenRouter
  video-model list.

---

## 9. Known follow-ups / not done yet

- **Async generation**: generation currently blocks the request while polling.
  A background job/queue + webhook (`callback_url`) would be the next step.
- **Migrations**: only `prisma db push` is wired into the container; no committed
  migration history yet.
- **FaceFusion integration**: the service is in compose but not yet wired into the
  app (face-swap flow comes later).
- **Email verification / transactional email**: `requireEmailVerification` is off;
  no email server configured.
- **Cross-origin cookies**: works for local `localhost:5173 ↔ :4000`; revisit
  cookie/domain settings for real deployments.
- **Pricing**: intentionally not shown (per spec).
