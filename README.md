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
docker compose up -d --build               # PostgreSQL + MinIO built from pinned upstream source

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
| Document storage | **MinIO is the selected deployment backend** (`STORAGE_DRIVER=minio`), reusing the existing S3-compatible driver. Private bucket, dedicated app credentials, API-signed upload/download links, 300-second default TTL. `local` remains development-only; existing `s3` and `cloudinary` configurations are retained for migration compatibility. See [MinIO deployment guide](docs/MINIO_DEPLOYMENT.md). |

Open policies (payment/refund, customer cancellation) remain outside this delivery;
the schema reserves payment state (`PaymentStatus.NOT_CONFIGURED`). Notifications now have a dedicated
Gmail SMTP worker, disabled by default, with per-recipient delivery tracking, encrypted payloads, dry-run,
shared rate limits and token eligibility checks. Apply the additive notification migration before running
the new API/worker. GoSMS is adapter-only: live SMS, customer-contact routing, OTP and reminders are not active.
See [notification deployment and test guide](docs/NOTIFICATIONS_DEPLOYMENT.md) and the
[implementation plan](docs/EMAIL_GMAIL_GOSMS_IMPLEMENTATION_PLAN.md).

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
documents (STR/SIP scans) use the private upload flow described below.

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
mask the patient and hide the address. Clinic pre-visit cancellation is implemented below; customer cancellation,
payment/refund stay unimplemented. Approval expiry is opt-in; manual no-show and rescheduling are described below.

Clinic cancellation: `POST /clinic/orders/:id/cancel` requires existing `order:approve` permission and a trimmed
5–1000-character operational reason. Only `PENDING_APPROVAL` and `CONFIRMED` can become `CANCELLED`; started and
terminal visits cannot be cancelled or reopened. Pending orders hold no capacity. Confirmed orders return exactly
one reserved place; an absent/empty/foreign reservation aborts the entire transaction with a conflict.
Cancellation, assignment retirement (`UNASSIGNED` + timestamp), assignment summary, append-only status history,
audit and notification outbox commit together. Slot references, assignment records, items and monetary/payment
snapshots remain intact for traceability; cancellation never charges or refunds anything. Assignment edits share
the order version lock so concurrent cancellation/start cannot leave active assignments on a cancelled order.
The clinic detail UI reuses the reason dialog, shows cancellation history, and hides actions after cancellation;
platform views remain read-only. No schema migration, new permission, or email dispatcher is required.
Browser regression: `node preview/flow-order-cancellation.mjs` from `apps/admin-web` (isolated fixtures).
For real HTTP/PostgreSQL tests, see the opt-in isolated-schema scenario in `apps/api/test/smoke/README.md`.

Approval expiry is **disabled by default** (`ORDER_APPROVAL_EXPIRY_MODE=off`). Select `after_creation` plus
`ORDER_APPROVAL_EXPIRY_MINUTES` (positive integer, e.g. 1440 for 24 hours), or `at_visit` to use the scheduled
visit start. Creation-based TTL is measured from `createdAt` only; it does not silently introduce a second visit
cutoff. Choose the policy with operations before enabling it. Real `.env` settings are not modified automatically.
Restart the API after a policy change. **All existing pending orders are evaluated against the selected policy**;
review the backlog first because changing the policy can expire old pending bookings immediately.
An internal worker runs at startup and every 60 seconds (up to 25 oldest due orders per pass, no overlapping passes
in one process). Multiple API replicas are safe: only one status/version CAS can commit each expiry. An outage
does not lose work; the next sweep finds overdue pending orders. Large backlogs can take multiple passes.
Only `PENDING_APPROVAL` becomes `EXPIRED`. Pending orders reserve no capacity; an inconsistent reserved slot is
not silently released. Assignment retirement, append-only system history (`actorId=null`), audit and outbox commit
together. Prices, payment and item snapshots stay unchanged. No notification delivery or refund is performed.
Approval also checks expiry inside its transaction: it commits expiry then returns `409 ORDER_APPROVAL_EXPIRED`
without reserving capacity. Reload after a conflict; no expired order can be reopened or approved. The UI exposes
the expired filter/badge/history and refreshes order state after failed actions. No database migration is needed.

Manual no-show: `POST /clinic/orders/:id/no-show`, existing `order:progress` permission, operational reason of
5–1000 characters after trim. Initial conservative rule: only `CONFIRMED`, all items still `PENDING`, and server
time at/after `scheduledAt + sum(durationMinutes × quantity)`. Earlier requests return `409 NO_SHOW_TOO_EARLY`
with `details.eligibleAt`; started, terminal, empty or already progressed visits are refused. No automatic
no-show timer, grace-period assumption, penalty, refund, or payment mutation is introduced. Status becomes
`NO_SHOW`, all services become `NOT_PERFORMED` with reason and per-item history, assignments become inactive,
and order history/audit (`ORDER_NO_SHOW`)/notification outbox commit atomically. Status/version CAS prevents
races with start, cancellation, and assignment changes. Old slot references **and reserved count remain intact**:
the elapsed visit window is historical consumption, not capacity to reopen. Assignment records and monetary
snapshots are retained; terminal orders cannot be reopened. UI reuses the reason dialog and exposes a translated
status/filter, item outcome/reason and timeline. The API remains the clock authority and validates eligibility,
even if the action dialog is opened early. Platform views stay read-only. No migration or new dependency is needed.

Reschedule: `GET /clinic/orders/:id/reschedule-slots?date=YYYY-MM-DD` and `POST /clinic/orders/:id/reschedule`,
both requiring existing `order:approve`. Body: `{scheduledAt, version, reason}` (UTC slot start, current integer
version, trimmed 5–1000-character operational reason). Only future `CONFIRMED` orders with every item still
`PENDING` and an original reservation can move; pending, started, past and terminal visits cannot. The original
clinic/mode/items/prices/payment and existing assignments stay unchanged; no repricing, fee or refund is introduced.
The picker uses the **order's snapshot duration × quantities**, not current offerings, and the existing 60-day
booking horizon, weekly windows, blocks and capacity. Target selection is tentative, revalidated on commit.
Status/version CAS rejects stale forms; assigned practitioner rows and existing slot rows are locked in stable ID
order. Nakes must still be active/verified and affiliated on the new **clinic-local date**, without overlapping
confirmed/in-progress visits across clinics (including long visits that started more than a day earlier).
Reserve the target before releasing the old place; both capacity changes, order time/version, append-only
CONFIRMED→CONFIRMED schedule history, `ORDER_RESCHEDULED` audit and outbox commit together. Any failure leaves
the old booking intact. The history contains both localized times/timezone/reason; audit/outbox retain UTC values.
The UI reuses existing controls with clinic-local date + API-supplied UTC slots, error/empty/loading states and
a distinct “Jadwal diubah” timeline entry. No schema migration, new dependency or new permission is needed.

## Deploy

Storage setup for the server: [docs/MINIO_DEPLOYMENT.md](docs/MINIO_DEPLOYMENT.md). It includes Docker installation, pinned-source MinIO builds, private bucket/account bootstrap, API environment, SSH console access, smoke checks, backup/restore and cutover from the old backend. Use `deploy/minio/compose.yml` on the server; root `docker-compose.yml` has development-only credentials. Existing real `.env` files are not changed by this setup.

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
| `STORAGE_DRIVER` + its settings | `minio`; `S3_ENDPOINT` on the private/local network, `S3_REGION=us-east-1`, path-style true, private bucket and dedicated app credentials. See `deploy/minio/api-storage.env.example` |
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

Open items before production: outbox dispatcher; selecting/enabling approval expiry policy; customer cancellation and
payment policies; homecare service area and per-service practitioner qualification; brand colours and logo;
browser UAT and an accessibility pass of the new
pages; confirming the illustrative seed data (master services, document checklist) with operations; clinic media limits
(8 photos, 5 MB) and whether/how media appears in public discovery.

Admin clinic management is available at `/admin/facilities`: search, verification/operating/type filters,
pagination, create a draft clinic with an invited owner, update its profile, activate verified clinics,
suspend with a reason, and reissue pending invitations. Actions follow existing API permissions and audit logs.
The owner sets their password at `/accept-invitation?token=...`; invitations are queued in the existing
notification outbox, not delivered until a dispatcher is configured. No database migration is needed for these pages.
Browser regression: after building and starting `apps/admin-web`, run `node preview/flow-facilities.mjs`
from that directory (`WEB_URL` optionally changes the target URL). It checks desktop/mobile forms, permissions,
status actions, invitations, and overflow with isolated API fixtures; it is not a live database/email integration test.

Platform user management is available at `/admin/users` (not a global clinic-user directory): searchable,
paginated platform accounts, status/role filters, invitations, name/role edits, suspension, disabling, and re-enabling.
The API requires `platform-user:read` / `platform-user:manage`. Clinic-only users return 404 from this module;
existing emails cannot be silently promoted into platform accounts. Only a super admin can manage/promote super admins.
Self role/status changes and removing the last active super admin are blocked. Writes use serializable transactions
with bounded conflict retries; role/status changes revoke refresh sessions, while permissions/status are reloaded
on every protected request. Status changes also invalidate unused reset/invitation tokens and require an audit reason.
Re-enabling an account without a password returns it to `INVITED` with a fresh queued invitation, never directly `ACTIVE`.
No passwords/tokens are returned in user lists/details, no hard-delete is offered, and no schema migration is required.
Invitation email delivery still requires the outbox dispatcher. For isolated desktop/mobile browser regression,
run `node preview/flow-users.mjs` from `apps/admin-web` against a built/running web app (`WEB_URL` optional).

Order exceptions and pending age (spec §4, §14): the platform dashboard (`GET /admin/dashboard/summary` →
`exceptions`) lists orders that need attention, using status and schedule facts only: pending approval with the
visit start already passed, confirmed but not started with the visit start passed, and confirmed without full
assignment starting within 24 hours (or already started). The 24-hour window is a display choice, **not an SLA**;
no approval deadline is assumed. Rows carry no patient or address data and link to the read-only order detail.
The clinic inbox and the clinic dashboard show how long each pending order has waited ("Menunggu 3 jam") and flag a
passed visit start; no other threshold is assumed. No migration, permission, or contract change is needed.

Clinic profile media (spec §4 `/clinic/profile`): one logo and a photo gallery, managed under `/clinic/profile/media`
(read: `clinic:profile:read`, changes: `clinic:profile:update`) and shown read-only to the platform at
`GET /admin/facilities/:id/media` (`facility:read`). Working assumptions, pending confirmation:
- JPG/PNG only, at most 5 MB each (content signature checked), at most **8 photos** plus one logo; a new logo replaces
  the old one. Photos have an optional caption (≤ 200 characters) and a display order.
- Media is not part of verification: it stays editable while an application is under review, is never listed with
  verification documents, and changes nothing in the verification status.
- Files reuse the private document pipeline (owner type `FACILITY_MEDIA`, keys `facility-media/<facility>/<document>`)
  and are shown only through short-lived signed links. The web fetches them through CORS and displays a local blob,
  because the API keeps `Cross-Origin-Resource-Policy: same-origin`. Removing media deletes its record and then its
  stored bytes (best effort after commit). Every change is audited (`FACILITY_MEDIA_*`).
- **Public discovery does not expose media yet**: no customer-app contract exists for it. Platform moderation (removing
  a clinic's photo) is not offered; the platform view is read-only.
Requires migration `20261125000000_facility_media` (additive: one table, one enum, one enum value, a one-logo partial
unique index). Apply it before deploying the new API.

Clinic staff management is available at `/clinic/staff`: search, pagination, role/access filters, add a new
invited account, review role permissions, change its clinic role, enable/disable its membership with an audit
reason, and queue a replacement invitation. API IDs are membership IDs, not user IDs. Every read/write is scoped
to the caller's resolved facility; mutations recheck the actor's active membership and `staff:manage` permission
inside a serializable transaction. `staff:read` gates the page and role options. The existing roles are reused:
`CLINIC_OWNER_ADMIN` and `CLINIC_STAFF`; assigning a role does not edit shared/global role permissions.
Only owner/admin can grant or manage owner/admin access. Self role/access changes and removal of the last owner
with an active account are blocked. Existing email addresses are rejected rather than attaching another clinic's
or platform account without consent. Existing account identity cannot be edited from this clinic module.
Membership access is separate from global account status: disabling clinic access never disables the user globally,
revokes another clinic's session, or changes any other membership. Permissions are reloaded on each protected request.
Globally suspended/disabled accounts cannot be restored here. Pending invitations are replaced/revoked only for
exclusive clinic accounts; shared pending accounts require platform coordination for invitation reissue.
Email dispatch remains deliberately deferred; invitations stay in the notification outbox and no password/token
is returned to the UI. No schema migration or new dependency is required. Browser regression uses isolated fixtures:
`node preview/flow-staff.mjs` from `apps/admin-web` against a built/running web app (`WEB_URL` optional), not live email/DB.

Practitioner scans are available in admin practitioner details and the clinic affiliation list (Scan STR / SIP).
They reuse the private document driver (MinIO in deployment), signed init/PUT/complete flow, PDF/JPEG/PNG
signature checks, and 10 MiB limit. No schema migration, new bucket policy, or new dependency is required.
Each upload is server-bound to a practitioner and credential; only its initiating account can complete it.
The completion and credential attachment are transactional; replacing a scan preserves the old file as history.
Admin endpoints require `practitioner:review`, not merely directory read. Clinic endpoints require
`affiliation:manage`, ownership through `createdByFacilityId`, and a PROPOSED/ACTIVE affiliation in the caller's
resolved facility. Merely finding a practitioner by STR or affiliating with another clinic's practitioner does not
grant access to their private scans. Unknown/out-of-scope credentials and documents return 404.
Uploads are allowed in DRAFT/SUBMITTED/REVISION_REQUIRED/REJECTED only; UNDER_REVIEW/VERIFIED records are locked,
including uploads initiated before the status changed. Authorized existing scans remain viewable through short-lived
links; issuing a link is audited. Decisions snapshot current document IDs and approval accepts attached scans.
Uploading a scan never submits/verifies/activates a practitioner automatically, and scans are not made a new
mandatory condition for the existing STR verification workflow. Signed PUT is one-success-only to prevent replay
from overwriting reviewed bytes; if an upload process crashes while receiving bytes, initiate a fresh upload.
Regression: `node preview/flow-practitioner-documents.mjs` from `apps/admin-web` checks desktop/mobile with isolated
API fixtures. Backend tests also roundtrip real temporary local-file bytes with isolated metadata; a live MinIO/
PostgreSQL staging test is still required. Email dispatch remains deferred.

## Scripts

Swagger dan panduan integrasi: [docs/SWAGGER.md](docs/SWAGGER.md). Daftar endpoint beserta permission: [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md), dihasilkan bersama kontrak OpenAPI melalui `pnpm contracts:generate`.

| Command | What it does |
|---|---|
| `pnpm typecheck` / `pnpm test` | All workspaces |
| `pnpm contracts:generate` | Rebuild the API, export `openapi.json`, regenerate `schema.d.ts` |
| `pnpm --filter @nakes/api storage:check` | Verify MinIO PUT/HEAD/GET/DELETE with a disposable random probe object |
| `pnpm --filter @nakes/api prisma:migrate` | Create a new migration in development |
