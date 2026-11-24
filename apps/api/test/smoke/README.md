# End-to-end smoke test

## Notification worker (isolated PostgreSQL, no provider sends)

See [notification deployment guide](../../../../docs/NOTIFICATIONS_DEPLOYMENT.md). After building the API, run from `apps/api`:

```powershell
$env:SMOKE_ALLOW_ISOLATED_SCHEMA = '1'
node --env-file=.env test/smoke/notifications.mjs
```

Creates/migrates only a random `nakes_notifications_<hex>` schema and removes it in `finally`.
Uses fake SMTP/GoSMS transport; never sends to a real recipient or alters operational schema tables.
Checks encrypted token payloads, dry-run isolation, fan-out deduplication, concurrent claims/fencing,
crash recovery, token rechecks, accepted versus delivered, retry/UNKNOWN, allowlist, shared quota/pause,
and transaction rollback. Refuses production and requires explicit schema opt-in. Cleanup failure reports
only its generated schema name for operator recovery.

The existing order smoke helpers now decrypt fixture outbox payloads with the isolated API's generated key;
their status checks remain intact. Test runners force all real notification channels off.

## Existing API smoke suite

Exercises S2–S6 over HTTP against a **running** API: clinic registration and documents, practitioners and affiliations,
catalog and public discovery, schedules and slots, bookings and the full order lifecycle (approval race, full slot,
assignment conflict, completion rules), and the audit trail. About 130 checks.

> It **creates data** (clinics, practitioners, offerings, orders) and suspends/reactivates a clinic. Run it against a
> local or staging database or a throwaway schema — never against production with real users.

```bash
# The API must run with BOOKINGS_API_KEY set; the smoke admin must exist (SEED_SUPER_ADMIN_* + prisma:seed).
SMOKE_BOOKINGS_KEY=<same as BOOKINGS_API_KEY> \
node apps/api/test/smoke/smoke.mjs http://localhost:4000/api/v1 http://localhost:3000 <admin-email> <admin-password>

# Concurrency check of slot reservations on real PostgreSQL (needs DATABASE_URL; runs after the smoke test,
# which creates the clinic it uses):
cd apps/api && npx tsx test/smoke/reserve-race.ts
```

A throwaway-schema run used during development: point `DATABASE_URL`/`DIRECT_DATABASE_URL` at `?schema=nakes_smoke`,
`prisma:deploy`, `prisma:seed`, start the API on another port, run both scripts, then `DROP SCHEMA nakes_smoke CASCADE`.
The public schema is untouched.

## Practitioner scan integration (isolated PostgreSQL + real HTTP)

After building the API, run from `apps/api` in PowerShell:

```powershell
$env:SMOKE_ALLOW_ISOLATED_SCHEMA = '1'
node --env-file=.env test/smoke/practitioner-documents.mjs
```

The runner provisions with `DIRECT_DATABASE_URL` (fallback `DATABASE_URL`), creates a random
`nakes_docs_smoke_<hex>` schema, applies migrations only there, and creates disposable accounts/master data.
It starts its own API on an unused port with fresh secrets and temporary local storage, then tests real
login, scope isolation, upload-init/PUT/complete, file validation, signed downloads, replay/concurrent PUT,
replacement history, review locks, review document snapshots, and audit records. It never logs credentials,
uses no real admin account, and sends no email. It refuses `NODE_ENV=production` and requires explicit opt-in.
The API uses the configured runtime `DATABASE_URL` (including its pooler), scoped to the same generated schema;
provisioning and cleanup use the direct connection. Cleanup retries with fresh clients after connection failures.
Failure diagnostics expose only allowlisted error codes and connection-state flags, never raw API logs or credentials.
The runner stops its API and removes only its generated schema and validated temporary directory in `finally`.
Do not interrupt the process during cleanup; a cleanup error names the isolated schema for manual recovery.

This verifies PostgreSQL and HTTP with **local file storage**, not a live MinIO server. MinIO connectivity is
checked separately using `pnpm --filter @nakes/api storage:check` after its real endpoint/bucket/credentials are
configured. Do not treat the local integration result as a successful MinIO deployment test.

### Include clinic order cancellation

Set `$env:SMOKE_INCLUDE_ORDER_CANCELLATION = '1'` before the same isolated-schema command to additionally verify
real cancellation permissions/DTOs, pending and confirmed flows, one-winner cancellation races, capacity reuse,
assignment retirement/conflict removal, terminal-state rejection, history/audit/outbox uniqueness, and rollback
when a reservation is inconsistent. Fixtures are created only in the runner's random schema, never production tables.
No payment, refund or notification delivery is performed. Browser fixtures are tested separately with
`node preview/flow-order-cancellation.mjs` from `apps/admin-web` against the built/running web app.
For a focused order-only run, set `$env:SMOKE_ONLY_ORDER_CANCELLATION = '1'`; this reuses isolated account/clinic
setup but skips the practitioner document scenarios.

Add `$env:SMOKE_INCLUDE_ORDER_EXPIRY = '1'` to the focused order run to test expiry too. Only the disposable API
uses a one-hour creation-based policy; operational `.env` is unchanged. Tests cover late approval, multiple real
PostgreSQL sweepers, one system history/audit/outbox, cancellation races, unaffected fresh/confirmed orders, and
the API's automatic background timer. The last check can take up to 90 seconds. Without this flag the isolated
API explicitly disables expiry rather than inheriting an operational setting.

### Manual no-show (focused real PostgreSQL + HTTP)

From `apps/api` after building:

```powershell
$env:SMOKE_ALLOW_ISOLATED_SCHEMA = '1'
$env:SMOKE_ONLY_ORDER_NO_SHOW = '1'
node --env-file=.env test/smoke/practitioner-documents.mjs
```

This reuses only isolated account/clinic/order fixture setup, skips practitioner scan and cancellation scenarios,
and verifies no-show access (including staff vs read-only), DTO/elapsed-duration checks, all-item outcomes,
historical capacity/payment preservation, unique history/audit/outbox, no-show/start races and complete PostgreSQL
rollback when outbox delivery queuing fails. It is a private staging fixture, not a payment or email integration.
Expiry is disabled in this focused run unless explicitly requested with the separate expiry-test flag.
Browser regression remains `node preview/flow-order-cancellation.mjs` from `apps/admin-web`; it now covers
cancellation, expiry and no-show with intercepted fixture responses, not a live backend.

### Rescheduling (focused real PostgreSQL + HTTP)

Set `$env:SMOKE_ONLY_ORDER_RESCHEDULE = '1'` instead of other `SMOKE_ONLY_*` flags, with
`SMOKE_ALLOW_ISOLATED_SCHEMA=1`, then run the same isolated-schema command. It creates only disposable fixtures
and checks permissions, date/version/reason validation, snapshot-based slot picking, atomic capacity moves,
retained assignments/prices/payment, full/blocked/past/off-grid/horizon rejection, practitioner conflicts across
clinics, expired affiliations, one-winner concurrent moves, and complete rollback on outbox failure. Expiry stays
off unless the separate expiry test flag is explicitly set. Browser regression includes the reschedule dialog,
picker errors/empty states, reason/version payload, conflict handling and timeline at desktop/mobile widths.
