# End-to-end smoke test

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
