# Nakes Admin Platform

Platform Admin and Clinic Admin in one Next.js app, backed by a NestJS + PostgreSQL API.
Specification: Nakes Admin Web Platform Specification v1 (kept outside this repository; section numbers such as
"spec §5.5" in code and docs refer to it).

```
apps/
  api/          NestJS API (Prisma, PostgreSQL)          → http://localhost:4000/api/v1, docs at /api/docs
  admin-web/    Next.js App Router (/admin, /clinic)      → http://localhost:3000
packages/
  api-contracts/  openapi.json + generated TypeScript types
```

## Getting started

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
docker compose up -d                       # or point DATABASE_URL at your own PostgreSQL

cp apps/api/.env.example apps/api/.env     # set the secrets, DIRECT_DATABASE_URL, and SEED_SUPER_ADMIN_PASSWORD
cp apps/admin-web/.env.example apps/admin-web/.env.local

pnpm --filter @nakes/api prisma:deploy     # apply migrations
pnpm --filter @nakes/api prisma:seed       # permissions, roles, first super admin, sample master data, all regions

pnpm dev:api
pnpm dev:web
```

This repo uses its own pnpm store (`.npmrc` → `.pnpm-store/`) and enables optional dependencies, which
native packages (esbuild, Prisma engines) need on Windows.

## Decisions

| Topic | Choice |
|---|---|
| ORM | Prisma; migrations in `apps/api/prisma/migrations` |
| Auth | JWT access token (15 min) kept **in browser memory only**; opaque refresh token in an HTTP-only, `SameSite=Strict`, `Secure` (prod) cookie scoped to `/api/v1/auth`, rotated on every use, with reuse detection that revokes the whole session family. Refresh/logout also require a matching `Origin` (CSRF). |
| Authorization | Default deny. Every route declares `@Public`, `@Authenticated`, `@RequirePlatform(...)`, or `@RequireFacility(...)`. A clinic user's facility comes from their membership; `X-Facility-Id` only selects among their own memberships. |
| Errors | `{ code, message, details, requestId }`; validation errors are `422 VALIDATION_FAILED` with `details.fields`. |
| Money | `Decimal(14,2)`, currency `IDR`. |
| Document storage | `STORAGE_DRIVER`: `local` (development only, refused in production), `s3` (AWS S3, Cloudflare R2, MinIO), or `cloudinary` (interim). Objects are always private and served only through the API's 5-minute signed links; on Cloudinary they are `raw` assets of type `authenticated`. Cloudinary hosts data outside Indonesia, so production documents should move to S3 Jakarta (`ap-southeast-3`) or R2. `docker compose up -d` also starts MinIO for trying `s3` locally. |

Open policies (payment, approval SLA/expiry, cancellation/refund, notification channel) are **not implemented**;
the schema only reserves their states (`PaymentStatus.NOT_CONFIGURED`, `CANCELLED`/`EXPIRED`/`NO_SHOW`) and the
`NotificationDispatcher` interface.

## UI design system

Follows the Nakes Homecare UI handoff design (Concept 2, Modern Light Healthcare; kept outside this repository).

- Tokens live only in `apps/admin-web/app/globals.css`. **The colours are prototype tokens, not verified against
  the brand**, and the logo in `components/brand/logo.tsx` is a placeholder until the official asset is supplied.
- Breakpoints: mobile `<768px` (drawer), tablet `768–1199px` (icon rail), desktop `≥1200px` (`desk:`, 248px sidebar,
  collapsible to 72px).
- Components: `components/ui` (shadcn-style, Radix + Lucide), `components/layout`, `components/status`,
  `components/feedback`.

**Previews without a database** (`apps/admin-web/preview/`, development only, fixtures clearly fake):

```bash
pnpm --filter @nakes/admin-web build && pnpm --filter @nakes/admin-web start   # :3000, API URL :4000
PREVIEW_ROLE=platform node apps/admin-web/preview/mock-api.mjs                 # or PREVIEW_ROLE=clinic
cd apps/admin-web && MSYS_NO_PATHCONV=1 node preview/screenshots.mjs preview/out dashboard=/admin
```

Screenshots are taken at 390, 768, 1024, and 1440px, and the script flags horizontal overflow.

## Delivery slices (spec §13)

| Slice | Status |
|---|---|
| S0 Foundations: schema, auth, permissions, audit, OpenAPI, CI; web shell, login, role layouts | Done |
| S1 Master data: CRUD for 7 taxonomies + region lookup/CSV import, with duplicate checks and audit | Done |
| S2 Facility onboarding | Done |
| S3 Nakes: practitioner registration/verification, encrypted STR/SIP, clinic affiliations | Done |
| S4 Catalog: clinic offerings with per-mode price/visit fee, publish rules, public discovery API | Done |
| S5 Availability: weekly hours per mode, blocks, computed slots, atomic capacity reservation, public slots | Done |
| S6 Orders: bookings API, order state machine, approval/rejection, assignment, item progress, platform read views | Done |
| S7 Hardening: access logs, transaction limits, direct migration URL, Docker images, smoke suite, deploy guide | Done (see open items) |

S3 working assumptions, pending confirmation (spec §1, §14): a valid **STR** is the minimum to verify a practitioner;
only STR and SIP credential types exist; clinics find practitioners by **exact STR number** (no directory browsing)
and may register a new one while proposing; a platform admin approves affiliations, and only for verified,
unsuspended practitioners. Credential numbers are AES-256-GCM encrypted with `CREDENTIAL_ENCRYPTION_KEY`, shown
masked, deduplicated by keyed hash, and revealed to reviewers only through an audited endpoint. Practitioner
document uploads (STR/SIP scans) are not built yet.

S4 rules: offerings start as drafts; publishing needs a verified, active clinic, a live master service and at least one
enabled mode, and is audited. A published offering cannot lose all its modes, the master service locks after the
draft stage, and archiving requires unpublishing first. Public discovery (`/public/facilities`, `/:id`,
`/:id/offerings?mode=`) only shows verified, active clinics, so suspending a clinic hides its catalog without
changing the offerings. Homecare service-area rules stay open (spec §1) and are not accepted yet. Re-run
`prisma:seed` to get sample master services.

S5 rules: weekly windows per mode (local time, `Asia/Jakarta`/`Makassar`/`Jayapura`, no DST) must not overlap; blocks
close whole days or a time range, for one mode or both. Slots are **computed**, not stored, until capacity is used:
approving an order materialises the slot and increments `reserved` with a conditional update, so concurrent approvals
cannot overbook (verified on PostgreSQL: 6 racing reservations on capacity 2 → exactly 2 win). **Pending orders hold no
capacity** — tentative holds, overbooking and lead time are open (spec §15). Customers see slots up to 60 days ahead,
only where the whole visit (sum of service durations × quantity) fits before the window closes and misses blocks.

S6 rules (spec §5.5, §6): `POST /bookings` is called by the customer app's backend with `BOOKINGS_API_KEY` and an
`Idempotency-Key` (retries return the same order; a key reused for another booking is refused). It re-validates the
clinic, every service (same clinic, published, mode enabled), the slot, and prices; snapshots names, prices, clinic and
address; and charges **one visit fee per homecare visit — the highest among the booked services** (assumption).
All status changes go through `order-state.ts` (allowed-from table + version check + history). Approval re-checks the
clinic, reserves capacity in the same transaction, and fails as a whole on a full slot; rejection needs a reason.
Assignment needs a verified, active practitioner with an active affiliation on the visit date and refuses overlapping
confirmed visits across clinics; **per-service qualification is not checked** (mapping open). A visit starts only when
fully assigned and completes only when every service is completed or not performed (with reason). Platform views
mask the patient and hide the address. Cancellation, expiry, no-show, payment and reschedule stay unimplemented.

## Deploy

Two services and a database. Images build from the repository root (Dockerfiles are written but were not built in
development, where Docker was unavailable — build once in CI or locally before relying on them):

```bash
docker build -f apps/api/Dockerfile -t nakes-api .
docker build -f apps/admin-web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 -t nakes-web .
```

Release order for every deploy:

1. **Migrate** with the direct (non-pooled) URL: `pnpm --filter @nakes/api prisma:deploy` (in the image:
   `docker run --rm --env-file api.env nakes-api pnpm --filter @nakes/api prisma:deploy`).
2. **Seed** on first deploy (idempotent; existing rows are not changed): `pnpm --filter @nakes/api prisma:seed`.
   It includes all 91,599 Indonesian regions down to villages (about 1–2 minutes the first time, skipped once complete;
   `SEED_REGIONS=false` to skip). Source and MIT notice: `apps/api/prisma/data/REGIONS_NOTICE.md`.
3. Start the API (`node dist/main.js`, health at `/api/v1/health`), then the web.

API environment (validated at boot; the API refuses to start when something required is missing or unsafe):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (disables Swagger, requires `COOKIE_SECURE=true`, refuses `STORAGE_DRIVER=local`) |
| `DATABASE_URL` | Pooled URL for the app (Neon `-pooler` host) |
| `DIRECT_DATABASE_URL` | Direct URL for migrations — **required**; a pooler can leave the migration lock stuck |
| `WEB_ORIGIN` | Exact web origin, e.g. `https://admin.example.com` (CORS and CSRF checks) |
| `API_PUBLIC_URL` | Public API base incl. `/api/v1` (signed document links) |
| `JWT_ACCESS_SECRET`, `STORAGE_SIGNING_SECRET`, `CREDENTIAL_ENCRYPTION_KEY` | Three different random strings ≥ 32 chars. **Never rotate `CREDENTIAL_ENCRYPTION_KEY`** without re-encrypting: stored STR/SIP numbers become unreadable |
| `COOKIE_SECURE` | `true` (HTTPS). Web and API should share a registrable domain so the `SameSite=Strict` refresh cookie is sent |
| `STORAGE_DRIVER` + its settings | `s3` (R2/S3 Jakarta) or `cloudinary`; see `apps/api/.env.example` |
| `BOOKINGS_API_KEY` | ≥ 32 chars to enable bookings; empty disables them |
| `PASSWORD_RESET_URL`, `INVITATION_URL` | Web URLs `…/reset-password`, `…/accept-invitation` |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | Only for the first seed; remove afterwards |

Web environment: `NEXT_PUBLIC_API_URL` (build time).

Operational notes:

- **Region.** Every request makes several sequential database round trips; with the database in `us-east-2` and users in
  Indonesia, multi-step actions take seconds. Put the database and API in Singapore (Neon `aws-ap-southeast-1`) or
  Jakarta. Interactive transactions allow 20 s (`TRANSACTION_OPTIONS`) so slow links do not abort correct work.
- **Logs.** One structured access line per request (method, path, status, duration, request id, user) — no bodies, no
  query strings (signed links carry tokens there). 5xx errors are logged with stack and request id; the same id is in
  the error envelope the user sees.
- **Scaling.** Rate limits (`@nestjs/throttler`) are in memory, per instance. Behind several instances, put a shared
  limit at the edge or move the throttler storage to Redis.
- **Backups.** Use the database's point-in-time recovery (Neon keeps history per plan) and versioning or lifecycle rules
  on the document bucket. Test a restore before go-live.
- **Notifications.** Domain events go to `notification_outbox` (order status, verification decisions); no dispatcher
  sends them yet — the channel is still open (spec §14).
- **Smoke test** after deploying to staging: `apps/api/test/smoke/README.md` (creates data; not for production).

Open items before production: practitioner document uploads; outbox dispatcher; order cancellation/expiry/no-show and
payment policies; homecare service area and per-service practitioner qualification; staff management (`/clinic/staff`,
`/admin/users`, `/admin/facilities` pages); brand colours and logo; browser UAT and an accessibility pass of the new
pages; confirming the illustrative seed data (master services, document checklist) with operations.

## Scripts

| Command | What it does |
|---|---|
| `pnpm typecheck` / `pnpm test` | All workspaces |
| `pnpm contracts:generate` | Rebuild the API, export `openapi.json`, regenerate `schema.d.ts` |
| `pnpm --filter @nakes/api prisma:migrate` | Create a new migration in development |
