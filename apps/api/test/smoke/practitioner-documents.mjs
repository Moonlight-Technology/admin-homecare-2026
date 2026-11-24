/** Real HTTP + PostgreSQL integration; creates/drops ONLY its own random schema and temporary local files.
 * From apps/api after build:
 * SMOKE_ALLOW_ISOLATED_SCHEMA=1 node --env-file=.env test/smoke/practitioner-documents.mjs
 * No real admin credentials, existing tables, real document storage, or email providers are used.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { PLATFORM_PERMISSIONS, FACILITY_PERMISSIONS, SYSTEM_ROLES } = require('../../dist/modules/users-access/permissions.catalog.js');
const { signLink } = require('../../dist/modules/documents/signed-link.js');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const schema = `nakes_docs_smoke_${randomBytes(8).toString('hex')}`;
const validSchema = () => /^nakes_docs_smoke_[a-f0-9]{16}$/.test(schema);
let checks = 0;
let stage = 'preflight';
let created = false;
let directory;
let apiProcess;
let database;
let maintenance;
let apiDiagnostics = '';
let cleanupUrl;

function safeDiagnostics(raw, error) {
  // Only predefined labels/codes leave the diagnostic buffer; never SQL, credentials, URLs or request bodies.
  const text = `${raw || ''} ${error?.code || ''} ${error?.errorCode || ''} ${error?.message || ''}`;
  return JSON.stringify({
    prismaCodes: [...new Set(text.match(/\bP\d{4}\b/g) ?? [])],
    nodeCodes: [...new Set(text.match(/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOENT|EACCES|EPERM)\b/g) ?? [])],
    connectionClosed: /server has closed|connection (?:was )?closed|connection reset/i.test(text),
    databaseUnreachable: /can't reach database|database.*unreachable/i.test(text),
    transactionTimeout: /transaction.*(?:expired|timeout|timed out)|transaction not found/i.test(text),
    advisoryLockTimeout: /advisory lock/i.test(text),
  });
}

function check(name, condition) {
  assert.ok(condition, name);
  checks++;
  console.log(`PASS ${name}`);
}
async function command(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let diagnostics = '';
  const capture = (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-64_000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const [code] = await once(child, 'exit');
  const codes = [...new Set(diagnostics.match(/\bP\d{4}\b/g) ?? [])].join(',');
  const hint = /advisory lock/i.test(diagnostics) ? ' advisory-lock timeout; check direct non-pooled connection' : '';
  assert.equal(code, 0, `Isolated ${stage} command failed (${codes || 'no Prisma code'}${hint}; sensitive output suppressed).`);
}
async function freePort() {
  const socket = createServer();
  await new Promise((done, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}

try {
  assert.equal(process.env.SMOKE_ALLOW_ISOLATED_SCHEMA, '1', 'Set SMOKE_ALLOW_ISOLATED_SCHEMA=1 to authorize temporary schema creation/cleanup.');
  assert.notEqual(process.env.NODE_ENV, 'production', 'Refusing a production environment.');
  const sourceUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(sourceUrl, 'Database connection must be configured.');
  assert.ok(validSchema(), 'Unsafe generated schema name.');
  const isolatedUrl = new URL(sourceUrl);
  isolatedUrl.searchParams.set('schema', schema);
  const runtimeUrl = new URL(process.env.DATABASE_URL || sourceUrl);
  runtimeUrl.searchParams.set('schema', schema);
  cleanupUrl = sourceUrl;
  maintenance = new PrismaClient({ datasources: { db: { url: sourceUrl } }, log: [] });
  await maintenance.$queryRaw`SELECT 1`;
  console.log('PHASE PostgreSQL connected; preparing random isolated schema.');
  // Identifier is generated internally and strictly validated; no existing schema name is accepted as input.
  await maintenance.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  directory = await mkdtemp(join(tmpdir(), 'nakes-docs-integration-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/api/v1`;
  const password = `Integration-${randomBytes(24).toString('hex')}!`;
  const signingSecret = randomBytes(32).toString('hex');
  const env = {
    ...process.env,
    NODE_ENV: 'development', DATABASE_URL: runtimeUrl.toString(), DIRECT_DATABASE_URL: isolatedUrl.toString(),
    PORT: String(port), WEB_ORIGIN: origin, API_PUBLIC_URL: base,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), STORAGE_SIGNING_SECRET: signingSecret,
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'), COOKIE_SECURE: 'false',
    STORAGE_DRIVER: 'local', STORAGE_DIR: directory, BOOKINGS_API_KEY: '',
    INVITATION_URL: `${origin}/accept-invitation`, PASSWORD_RESET_URL: `${origin}/reset-password`,
    SEED_SUPER_ADMIN_EMAIL: '', SEED_SUPER_ADMIN_PASSWORD: '',
    NOTIFICATIONS_ENABLED: 'false', NOTIFICATIONS_EMAIL_ENABLED: 'false', NOTIFICATIONS_SMS_ENABLED: 'false', NOTIFICATIONS_MODE: 'dry-run',
    // Test policy only; never inherit or edit the operational expiry setting.
    ORDER_APPROVAL_EXPIRY_MODE: process.env.SMOKE_INCLUDE_ORDER_EXPIRY === '1' ? 'after_creation' : 'off',
    ORDER_APPROVAL_EXPIRY_MINUTES: process.env.SMOKE_INCLUDE_ORDER_EXPIRY === '1' ? '60' : '0',
  };
  stage = 'migrations';
  await command(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  database = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } }, log: [], transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  // Prisma qualifies model tables explicitly; pooled connections may retain public as their SQL search_path.
  const tables = await database.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('users', 'documents', 'practitioner_credentials')`;
  check('migrations created tables in the generated isolated schema', tables[0]?.count === 3);
  stage = 'fixtures';
  const permissions = [
    ...Object.values(PLATFORM_PERMISSIONS).map((code) => ({ code, scope: 'PLATFORM' })),
    ...Object.values(FACILITY_PERMISSIONS).map((code) => ({ code, scope: 'FACILITY' })),
  ];
  await database.permission.createMany({ data: permissions });
  await database.role.createMany({ data: SYSTEM_ROLES.map(({ code, name, scope }) => ({ code, name, scope })) });
  const roleRows = await database.role.findMany();
  const permissionRows = await database.permission.findMany();
  const roleId = (code) => roleRows.find((role) => role.code === code).id;
  await database.rolePermission.createMany({ data: SYSTEM_ROLES.flatMap((role) => role.permissions.map((code) => ({ roleId: roleId(role.code), permissionId: permissionRows.find((permission) => permission.code === code).id }))) });
  const hash = await argon2.hash(password);
  await database.user.create({ data: { email: 'admin@isolated.test', name: 'Integration Admin', passwordHash: hash, status: 'ACTIVE', memberships: { create: { scopeType: 'PLATFORM', roleId: roleId('PLATFORM_SUPER_ADMIN') } } } });
  assert.ok(validSchema(), 'Unsafe fixture verification target.');
  const written = await database.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${schema}"."users" WHERE email = $1`, 'admin@isolated.test');
  check('Prisma fixture writes target only the generated schema', written[0]?.count === 1);
  const readRole = await database.role.create({ data: { code: 'INTEGRATION_READ_ONLY', name: 'Integration read only', scope: 'PLATFORM', permissions: { create: { permissionId: permissionRows.find((permission) => permission.code === 'practitioner:read').id } } } });
  await database.user.create({ data: { email: 'reader@isolated.test', name: 'Integration Reader', passwordHash: hash, status: 'ACTIVE', memberships: { create: { scopeType: 'PLATFORM', roleId: readRole.id } } } });
  const facilityType = await database.facilityType.create({ data: { code: 'TEST_CLINIC', name: 'Integration Clinic' } });
  const capability = await database.capability.create({ data: { code: 'TEST_OUTPATIENT', name: 'Integration Outpatient' } });
  const practitionerType = await database.practitionerType.create({ data: { code: 'TEST_DOCTOR', name: 'Integration Doctor' } });
  console.log('PHASE fixtures ready; starting isolated API with local temporary storage (not MinIO).');
  stage = 'API startup';
  apiProcess = spawn(process.execPath, ['dist/main.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const captureApi = (chunk) => { apiDiagnostics = (apiDiagnostics + chunk.toString()).slice(-256_000); };
  apiProcess.stdout.on('data', captureApi); apiProcess.stderr.on('data', captureApi);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (apiProcess.exitCode !== null) throw new Error('Isolated API exited before becoming healthy.');
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (attempt === 99) throw new Error('Isolated API health timeout.');
    await sleep(300);
  }
  stage = 'HTTP document checks';
  async function call(method, path, token, body, extra = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    return { status: response.status, json: await response.json().catch(() => null) };
  }
  async function expect(method, path, token, body, status, name) {
    const result = await call(method, path, token, body);
    check(`${name} (HTTP ${result.status}, expected ${status})`, result.status === status);
    return result.json;
  }
  const admin = (await expect('POST', '/auth/login', null, { email: 'admin@isolated.test', password }, 200, 'real admin login')).accessToken;
  const reader = (await expect('POST', '/auth/login', null, { email: 'reader@isolated.test', password }, 200, 'read-only account login')).accessToken;
  async function clinic(label) {
    const registered = await expect('POST', '/clinic-registration', null, { owner: { name: `Owner ${label}`, email: `owner-${label}@isolated.test`, password }, facility: { displayName: `Clinic ${label}`, legalName: `PT Clinic ${label}`, facilityTypeId: facilityType.id, capabilityIds: [capability.id], phone: '0215550123', addressLine: 'Jl. Integration Test 10' } }, 201, `register fixture clinic ${label}`);
    // Fixture eligibility only, within the new isolated schema; production verification is not bypassed.
    await database.facility.update({ where: { id: registered.facilityId }, data: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } });
    await database.provider.updateMany({ where: { facilityId: registered.facilityId }, data: { status: 'ACTIVE' } });
    const token = (await expect('POST', '/auth/login', null, { email: `owner-${label}@isolated.test`, password }, 200, `owner ${label} login`)).accessToken;
    return { id: registered.facilityId, token };
  }
  const a = await clinic('a');
  const b = await clinic('b');
  const registration = { fullName: 'dr. Integration Documents', practitionerTypeId: practitionerType.id, credentials: [{ credentialType: 'STR', number: `STR-${randomBytes(8).toString('hex')}` }, { credentialType: 'SIP', number: `SIP-${randomBytes(8).toString('hex')}` }] };
  const affiliation = await expect('POST', '/clinic/practitioner-affiliations', a.token, { practitioner: registration }, 201, 'clinic registers practitioner via real affiliation API');
  const id = affiliation.practitioner.id;
  const path = `/clinic/practitioners/${id}`;
  const adminPath = `/admin/practitioners/${id}`;
  if (process.env.SMOKE_ONLY_ORDER_CANCELLATION !== '1' && process.env.SMOKE_ONLY_ORDER_NO_SHOW !== '1' && process.env.SMOKE_ONLY_ORDER_RESCHEDULE !== '1') {
  const state = await expect('GET', `${path}/documents`, a.token, undefined, 200, 'creator clinic reads document metadata');
  check('STR and SIP are masked and editable', state.credentials.length === 2 && state.editable && !JSON.stringify(state).includes(registration.credentials[0].number));
  const str = state.credentials.find((credential) => credential.credentialType === 'STR').id;
  const sip = state.credentials.find((credential) => credential.credentialType === 'SIP').id;
  const docPath = (prefix, credential) => `${prefix}/credentials/${credential}/documents`;
  const pdf = Buffer.from('%PDF-1.7\n% real HTTP integration test\n');
  const input = { fileName: 'integration-str.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length };
  await expect('GET', `${adminPath}/documents`, null, undefined, 401, 'anonymous request denied');
  await expect('GET', `${adminPath}/documents`, reader, undefined, 403, 'directory read does not grant private scan access');
  await expect('GET', `${path}/documents`, b.token, undefined, 404, 'another clinic cannot read private metadata');
  await expect('POST', `${docPath(path, str)}/upload-init`, b.token, input, 404, 'another clinic cannot initiate upload');
  await expect('POST', `${docPath(path, randomUUID())}/upload-init`, a.token, input, 404, 'foreign credential rejected');
  await expect('POST', `${docPath(path, str)}/upload-init`, a.token, { ...input, mimeType: 'text/html' }, 422, 'HTML upload rejected');
  await expect('POST', `${docPath(path, str)}/upload-init`, a.token, { ...input, sizeBytes: 0 }, 422, 'empty upload rejected');
  await expect('POST', `${docPath(path, str)}/upload-init`, a.token, { ...input, sizeBytes: 10 * 1024 * 1024 + 1 }, 422, 'oversized upload rejected');
  await expect('POST', `${docPath(path, str)}/upload-init`, a.token, { ...input, ownerId: b.id }, 422, 'owner injection rejected');
  async function init(prefix, credential, token, data = input) {
    const result = await expect('POST', `${docPath(prefix, credential)}/upload-init`, token, data, 201, 'signed upload initialized');
    check('storage key stays private', !JSON.stringify(result).includes('objectKey'));
    return result;
  }
  async function put(upload, bytes, expected = 204, name = 'raw file bytes accepted') {
    const response = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes, signal: AbortSignal.timeout(45_000) });
    const responseBody = await response.text();
    if (response.status >= 500) {
      let errorCode;
      try { errorCode = JSON.parse(responseBody)?.code; } catch {}
      console.error(`HTTP upload diagnostic: ${/^[A-Z_]+$/.test(errorCode || '') ? errorCode : 'unknown'} ${safeDiagnostics(apiDiagnostics)}`);
    }
    check(`${name} (HTTP ${response.status})`, response.status === expected);
  }
  async function complete(prefix, credential, token, documentId, expected = 200) {
    return expect('POST', `${docPath(prefix, credential)}/complete`, token, { documentId }, expected, 'complete validates and attaches document');
  }
  const first = await init(path, str, a.token);
  await complete(path, str, a.token, first.document.id, 422);
  check('incomplete upload is not attached', (await database.practitionerCredential.findUnique({ where: { id: str } })).documentId === null);
  await put({ ...first.upload, url: first.upload.url.replace(/token=.*/, 'token=forged') }, pdf, 403, 'forged upload token denied');
  await put(first.upload, pdf);
  await put(first.upload, pdf, 409, 'successful upload URL cannot overwrite bytes');
  await complete(path, sip, a.token, first.document.id, 404);
  await complete(adminPath, str, admin, first.document.id, 404);
  await complete(path, str, b.token, first.document.id, 404);
  await complete(path, str, a.token, first.document.id);
  const link = await expect('GET', `${docPath(path, str)}/${first.document.id}/url`, a.token, undefined, 200, 'authorized signed preview link');
  const content = await fetch(link.url);
  check('real HTTP download returns identical bytes', content.status === 200 && Buffer.from(await content.arrayBuffer()).equals(pdf));
  check('private download has no-store and nosniff headers', content.headers.get('cache-control')?.includes('no-store') && content.headers.get('x-content-type-options') === 'nosniff');
  const noToken = new URL(link.url); noToken.search = '';
  check('direct download without signed token denied', (await fetch(noToken)).status === 403);
  const expired = new URL(link.url); expired.searchParams.set('token', signLink(signingSecret, first.document.id, 'download', -1).token);
  check('expired signed link denied', (await fetch(expired)).status === 403);
  await expect('GET', `${docPath(path, str)}/${first.document.id}/url`, b.token, undefined, 404, 'cross-clinic preview denied');
  await expect('GET', `${docPath(path, sip)}/${first.document.id}/url`, a.token, undefined, 404, 'wrong credential preview denied');

  const replacement = await init(path, str, a.token);
  const fakePdf = Buffer.alloc(pdf.length, 65);
  await put(replacement.upload, fakePdf, 422, 'fake PDF signature rejected');
  await complete(path, str, a.token, replacement.document.id, 422);
  await put(replacement.upload, pdf);
  await complete(path, str, a.token, replacement.document.id);
  check('replacement preserves prior file and updates only credential pointer', await database.document.count({ where: { id: { in: [first.document.id, replacement.document.id] }, status: 'UPLOADED' } }) === 2 && (await database.practitionerCredential.findUnique({ where: { id: str } })).documentId === replacement.document.id);
  const oldLink = await expect('GET', `${docPath(adminPath, str)}/${first.document.id}/url`, admin, undefined, 200, 'reviewer can read retained historical scan');
  const oldContent = await fetch(oldLink.url);
  check('historical scan bytes remain unchanged', Buffer.from(await oldContent.arrayBuffer()).equals(pdf));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const sipUpload = await init(path, sip, a.token, { fileName: 'sip.png', mimeType: 'image/png', sizeBytes: png.length });
  const race = await Promise.all([0, 1].map(() => fetch(sipUpload.upload.url, { method: 'PUT', headers: sipUpload.upload.headers, body: png })));
  await Promise.all(race.map((response) => response.arrayBuffer()));
  check('concurrent signed PUT allows exactly one writer', race.map((response) => response.status).sort().join(',') === '204,409');
  await complete(path, sip, a.token, sipUpload.document.id);
  check('upload did not auto-verify practitioner', (await database.practitioner.findUnique({ where: { id } })).verificationStatus === 'SUBMITTED');

  const waiting = await init(path, str, a.token);
  await put(waiting.upload, pdf);
  await expect('POST', `${adminPath}/start-review`, admin, undefined, 200, 'start real practitioner review');
  await expect('POST', `${docPath(path, str)}/upload-init`, a.token, input, 409, 'review locks new uploads');
  await complete(path, str, a.token, waiting.document.id, 409);
  await expect('POST', `${adminPath}/reviews`, admin, { decision: 'APPROVE' }, 200, 'approve practitioner with attached scans');
  const decision = await database.verificationReview.findFirst({ where: { targetType: 'PRACTITIONER', targetId: id, decision: 'APPROVE' } });
  check('review snapshots STR/SIP IDs, excluding unattached upload', decision.documentIds.length === 2 && decision.documentIds.includes(replacement.document.id) && decision.documentIds.includes(sipUpload.document.id) && !decision.documentIds.includes(waiting.document.id));
  check('approval accepts exactly the attached scans', await database.document.count({ where: { id: { in: decision.documentIds }, status: 'ACCEPTED' } }) === 2);
  await expect('POST', `${docPath(adminPath, str)}/upload-init`, admin, input, 409, 'verified practitioner cannot replace scan');
  await expect('GET', `${docPath(path, str)}/${replacement.document.id}/url`, a.token, undefined, 200, 'verified scan remains viewable');

  const foreign = await expect('POST', '/admin/practitioners', admin, { ...registration, fullName: 'dr. Other Registrant', credentials: [{ credentialType: 'STR', number: `OTHER-${randomBytes(8).toString('hex')}` }] }, 201, 'register practitioner from another origin');
  await expect('POST', '/clinic/practitioner-affiliations', a.token, { practitionerId: foreign.id }, 201, 'clinic may propose an existing practitioner');
  await expect('GET', `/clinic/practitioners/${foreign.id}/documents`, a.token, undefined, 404, 'affiliation alone grants no access to another origin scans');
  await expect('PATCH', `/clinic/practitioner-affiliations/${affiliation.id}`, a.token, { action: 'WITHDRAW' }, 200, 'withdraw still-pending clinic affiliation');
  await expect('GET', `${path}/documents`, a.token, undefined, 404, 'ended affiliation loses metadata access immediately');
  const audit = await database.auditLog.findMany({ where: { entityId: id, event: { startsWith: 'PRACTITIONER_DOCUMENT_' } }, select: { event: true, actorId: true, facilityId: true } });
  check('document init, attachment and link issuance are audited', ['PRACTITIONER_DOCUMENT_UPLOAD_INITIATED', 'PRACTITIONER_DOCUMENT_ATTACHED', 'PRACTITIONER_DOCUMENT_LINK_ISSUED'].every((event) => audit.some((entry) => entry.event === event && entry.actorId)));
  check('clinic audit entries retain the correct facility scope', audit.some((entry) => entry.facilityId === a.id) && !audit.some((entry) => entry.facilityId === b.id));
  }
  let orderFixtures;
  if (process.env.SMOKE_INCLUDE_ORDER_CANCELLATION === '1' || process.env.SMOKE_ONLY_ORDER_CANCELLATION === '1' || process.env.SMOKE_ONLY_ORDER_NO_SHOW === '1' || process.env.SMOKE_ONLY_ORDER_RESCHEDULE === '1') {
    stage = 'HTTP order cancellation checks';
    const { orderCancellation } = await import('./order-cancellation.mjs');
    orderFixtures = await orderCancellation({ database, a, b, practitionerId: id, password, expect, call, check, notificationSecret: env.CREDENTIAL_ENCRYPTION_KEY, setupOnly: process.env.SMOKE_ONLY_ORDER_NO_SHOW === '1' || process.env.SMOKE_ONLY_ORDER_RESCHEDULE === '1' });
  }
  if (process.env.SMOKE_ONLY_ORDER_RESCHEDULE === '1') {
    stage = 'HTTP reschedule checks';
    const { orderReschedule } = await import('./order-reschedule.mjs');
    await orderReschedule({ database, a, b, practitionerId: id, expect, call, check, ...orderFixtures });
  }
  if (process.env.SMOKE_ONLY_ORDER_NO_SHOW === '1') {
    stage = 'HTTP manual no-show checks';
    const { orderNoShow } = await import('./order-no-show.mjs');
    await orderNoShow({ database, a, b, practitionerId: id, password, expect, call, check, notificationSecret: env.CREDENTIAL_ENCRYPTION_KEY, ...orderFixtures });
  }
  if (process.env.SMOKE_INCLUDE_ORDER_EXPIRY === '1') {
    stage = 'HTTP order expiry checks';
    const { orderExpiry } = await import('./order-expiry.mjs');
    await orderExpiry({ database, a, expect, call, check, notificationSecret: env.CREDENTIAL_ENCRYPTION_KEY });
  }
  console.log(`RESULT ${checks} real HTTP/PostgreSQL checks passed. Storage: temporary local files; NOT MinIO.`);
} catch (error) {
  // Avoid printing SDK/database errors which can include endpoint/connection details.
  console.error(`FAIL during ${stage}: ${error instanceof assert.AssertionError ? error.message : error?.code || 'execution error (sensitive details suppressed)'}`);
  console.error(`SAFE DIAGNOSTICS ${safeDiagnostics(apiDiagnostics, error)}`);
  process.exitCode = 1;
} finally {
  if (apiProcess && apiProcess.exitCode === null) {
    const stopped = once(apiProcess, 'exit'); apiProcess.kill();
    await stopped;
  }
  await database?.$disconnect();
  if (created && maintenance) {
    assert.ok(validSchema(), 'Refusing unsafe schema cleanup.');
    for (let attempt = 0; attempt < 3; attempt++) {
      // Do not reuse the maintenance connection left idle during a long remote integration run.
      const cleanup = new PrismaClient({ datasources: { db: { url: cleanupUrl } }, log: [] });
      try {
        // IF EXISTS makes a retry safe even if a lost acknowledgement followed a committed DROP.
        await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log('CLEANUP isolated schema removed; existing schemas were not targeted.');
        break;
      } catch (error) {
        if (attempt === 2) { console.error(`CLEANUP FAILED for isolated schema ${schema}; existing schemas not targeted. ${safeDiagnostics('', error)}`); process.exitCode = 1; }
        else await sleep(500 * (attempt + 1));
      } finally { await cleanup.$disconnect(); }
    }
  }
  await maintenance?.$disconnect();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()), 'Unsafe temporary directory cleanup.');
    assert.ok(basename(directory).startsWith('nakes-docs-integration-'), 'Unsafe temporary directory cleanup.');
    await rm(directory, { recursive: true, force: true });
    console.log('CLEANUP disposable local test files removed.');
  }
}
