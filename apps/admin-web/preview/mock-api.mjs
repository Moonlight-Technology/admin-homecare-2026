/**
 * DEVELOPMENT PREVIEW ONLY — never deployed, never imported by the app.
 * A stand-in for the Nakes API so layouts can be checked without PostgreSQL (DESIGN.md §8.5).
 * All names and numbers below are illustrative fixtures, not real data.
 *
 *   PREVIEW_ROLE=platform|clinic node preview/mock-api.mjs   (listens on :4000, like the real API)
 */
import { createServer } from 'node:http';

const role = process.env.PREVIEW_ROLE === 'clinic' ? 'clinic' : 'platform';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
const inHours = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

const me = role === 'platform'
  ? {
      user: { id: 'u-platform', email: 'admin@nakes.local', name: 'Admin Platform' },
      memberships: [{ id: 'm1', scopeType: 'PLATFORM', role: { code: 'PLATFORM_SUPER_ADMIN', name: 'Platform Super Admin' }, facility: null }],
      platform: { roles: ['PLATFORM_SUPER_ADMIN'], permissions: ['platform:dashboard:read', 'facility:read', 'facility:review', 'practitioner:read', 'master:read', 'master:write', 'order:read-all', 'platform-user:read', 'audit:read'] },
      facility: null,
    }
  : {
      user: { id: 'u-clinic', email: 'owner@klinik-preview.test', name: 'Siti Rahayu' },
      memberships: [{ id: 'm2', scopeType: 'FACILITY', role: { code: 'CLINIC_OWNER_ADMIN', name: 'Clinic Owner / Admin' }, facility: { id: 'f1', displayName: 'Klinik Contoh Sehat', verificationStatus: 'UNDER_REVIEW', operatingStatus: 'INACTIVE' } }],
      platform: null,
      facility: { facilityId: 'f1', role: 'CLINIC_OWNER_ADMIN', permissions: ['clinic:dashboard:read', 'clinic:profile:read', 'clinic:verification:submit', 'offering:read', 'schedule:read', 'affiliation:read', 'order:read', 'staff:read'] },
    };

const routes = {
  'POST /api/v1/auth/refresh': () => ({ accessToken: 'preview-token', expiresIn: 900 }),
  'POST /api/v1/auth/logout': () => null,
  'GET /api/v1/me': () => me,
  'GET /api/v1/admin/dashboard/summary': () => ({
    kpis: { pendingFacilityReviews: 3, pendingPractitionerReviews: 2, activeFacilities: 12, pendingOrderApprovals: 4, openOrders: 9 },
    facilityQueue: [
      { id: 'f1', displayName: 'Klinik Contoh Sehat', verificationStatus: 'SUBMITTED', updatedAt: hoursAgo(26) },
      { id: 'f2', displayName: 'Klinik Contoh Medika', verificationStatus: 'REVISION_REQUIRED', updatedAt: hoursAgo(5) },
      { id: 'f3', displayName: 'Klinik Contoh Harapan', verificationStatus: 'UNDER_REVIEW', updatedAt: hoursAgo(2) },
    ],
    practitionerQueue: [
      { id: 'p1', fullName: 'dr. Contoh Pratama', verificationStatus: 'SUBMITTED', updatedAt: hoursAgo(8), practitionerType: { name: 'Dokter' } },
      { id: 'p2', fullName: 'Ns. Contoh Lestari', verificationStatus: 'UNDER_REVIEW', updatedAt: hoursAgo(3), practitionerType: { name: 'Perawat' } },
    ],
    recentOrders: [
      { id: 'o1', code: 'ORD-PREVIEW-0004', status: 'PENDING_APPROVAL', mode: 'HOMECARE', scheduledAt: inHours(20), createdAt: hoursAgo(1), itemCount: 2, facilityName: 'Klinik Contoh Sehat' },
      { id: 'o2', code: 'ORD-PREVIEW-0003', status: 'CONFIRMED', mode: 'ON_SITE', scheduledAt: inHours(4), createdAt: hoursAgo(6), itemCount: 1, facilityName: 'Klinik Contoh Medika' },
      { id: 'o3', code: 'ORD-PREVIEW-0002', status: 'IN_PROGRESS', mode: 'HOMECARE', scheduledAt: hoursAgo(1), createdAt: hoursAgo(30), itemCount: 3, facilityName: 'Klinik Contoh Harapan' },
    ],
    exceptions: {
      total: 3,
      counts: { pendingPastSchedule: 1, notStartedPastSchedule: 1, unassignedSoon: 2 },
      orders: [
        { id: 'o6', code: 'ORD-PREVIEW-0006', status: 'PENDING_APPROVAL', mode: 'ON_SITE', assignmentStatus: 'UNASSIGNED', scheduledAt: hoursAgo(3), createdAt: hoursAgo(28), itemCount: 1, facilityName: 'Klinik Contoh Medika', reasons: ['PENDING_PAST_SCHEDULE'] },
        { id: 'o7', code: 'ORD-PREVIEW-0007', status: 'CONFIRMED', mode: 'HOMECARE', assignmentStatus: 'PARTIALLY_ASSIGNED', scheduledAt: hoursAgo(1), createdAt: hoursAgo(20), itemCount: 2, facilityName: 'Klinik Contoh Sehat', reasons: ['NOT_STARTED_PAST_SCHEDULE', 'UNASSIGNED_SOON'] },
        { id: 'o2', code: 'ORD-PREVIEW-0003', status: 'CONFIRMED', mode: 'ON_SITE', assignmentStatus: 'UNASSIGNED', scheduledAt: inHours(4), createdAt: hoursAgo(6), itemCount: 1, facilityName: 'Klinik Contoh Medika', reasons: ['UNASSIGNED_SOON'] },
      ],
    },
  }),
  'GET /api/v1/clinic/dashboard/summary': () => ({
    facility: me.memberships[0].facility,
    kpis: { pendingApproval: 2, todayConfirmed: 5, todayInProgress: 1, activeOfferings: 0, unassignedVisits: 2 },
    pendingQueue: [
      { id: 'o6', code: 'ORD-PREVIEW-0006', status: 'PENDING_APPROVAL', mode: 'ON_SITE', scheduledAt: hoursAgo(3), createdAt: hoursAgo(28), itemCount: 1 },
      { id: 'o1', code: 'ORD-PREVIEW-0004', status: 'PENDING_APPROVAL', mode: 'HOMECARE', scheduledAt: inHours(20), createdAt: hoursAgo(1), itemCount: 2 },
      { id: 'o5', code: 'ORD-PREVIEW-0005', status: 'PENDING_APPROVAL', mode: 'ON_SITE', scheduledAt: inHours(30), createdAt: hoursAgo(3), itemCount: 1 },
    ],
  }),
  'GET /api/v1/admin/audit-logs': () => ({
    items: [
      { id: 'a1', event: 'AUTH_LOGIN', entityType: 'User', entityId: 'u-platform-0001', scope: 'PUBLIC', ip: '127.0.0.1', createdAt: hoursAgo(0.2), actor: { id: 'u', name: 'Admin Platform', email: 'admin@nakes.local' } },
      { id: 'a2', event: 'AUTH_PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: 'u-clinic-0001', scope: 'PUBLIC', ip: '127.0.0.1', createdAt: hoursAgo(3), actor: null },
    ],
    page: 1,
    limit: 20,
    total: 2,
  }),
};

// ─── Master data: in-memory tables that mimic the API rules (search, filters, duplicates → 409, bad code → 422) ───
let nextId = 1;
const row = (fields) => ({ id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, active: true, sortOrder: 0, createdAt: hoursAgo(48), updatedAt: hoursAgo(48), ...fields });
const master = {
  'facility-types': [row({ code: 'KLINIK', name: 'Klinik', sortOrder: 1 })],
  'clinic-classes': [row({ code: 'PRATAMA', name: 'Klinik Pratama', sortOrder: 1 }), row({ code: 'UTAMA', name: 'Klinik Utama', sortOrder: 2 })],
  'facility-capabilities': [row({ code: 'RAWAT_JALAN', name: 'Rawat jalan', sortOrder: 1 }), row({ code: 'RAWAT_INAP', name: 'Rawat inap', sortOrder: 2, active: false })],
  'practitioner-types': [row({ code: 'DOKTER', name: 'Dokter', sortOrder: 1 }), row({ code: 'PERAWAT', name: 'Perawat', sortOrder: 2 }), row({ code: 'BIDAN', name: 'Bidan', sortOrder: 3 })],
  'service-categories': [row({ slug: 'laboratorium', name: 'Laboratorium', sortOrder: 1 }), row({ slug: 'vaksinasi', name: 'Vaksinasi', sortOrder: 2 })],
  'master-services': [],
  'document-requirements': [row({ code: 'IZIN_OPERASIONAL', ownerType: 'FACILITY', name: 'Izin operasional klinik (contoh)', mandatory: true, description: null })],
};
const categoryOf = (id) => master['service-categories'].find((category) => category.id === id);
master['master-services'].push(row({ code: 'LAB_DARAH_LENGKAP', name: 'Pemeriksaan darah lengkap', categoryId: master['service-categories'][0].id, description: null }));
const withCategory = (record) => (record.categoryId ? { ...record, category: categoryOf(record.categoryId) } : record);
const regions = [
  { code: '31', name: 'DKI Jakarta', level: 1, parentCode: null },
  { code: '31.71', name: 'Kota Adm. Jakarta Pusat', level: 2, parentCode: '31' },
  { code: '32', name: 'Jawa Barat', level: 1, parentCode: null },
];
const keyOf = (resource) => (resource === 'service-categories' ? 'slug' : 'code');
const conflict = (field) => ({ status: 409, body: { code: 'DUPLICATE', message: `This ${field} is already used.`, details: { fields: { [field]: [`${field} is already used`] } } } });

function masterRoute(method, pathname, url, body) {
  const match = pathname.match(/^\/api\/v1\/admin\/master\/([a-z-]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const [, resource, id] = match;
  if (resource === 'regions') {
    if (method === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const items = regions.filter((region) => (!url.searchParams.get('level') || String(region.level) === url.searchParams.get('level')) && (!url.searchParams.get('parentCode') || region.parentCode === url.searchParams.get('parentCode')) && (!search || region.name.toLowerCase().includes(search) || region.code.startsWith(search)));
      return { body: { items: items.map((region) => ({ ...region, parent: regions.find((parent) => parent.code === region.parentCode) ?? null })), page: 1, limit: 50, total: items.length } };
    }
    if (method === 'POST' && id === 'import') {
      let created = 0;
      for (const incoming of body.rows) {
        const existing = regions.find((region) => region.code === incoming.code);
        if (existing) Object.assign(existing, incoming);
        else { regions.push(incoming); created += 1; }
      }
      return { body: { imported: body.rows.length, created, updated: body.rows.length - created } };
    }
  }
  const table = master[resource];
  if (!table) return null;
  const key = keyOf(resource);
  if (method === 'GET' && !id) {
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const active = url.searchParams.get('active');
    const filters = ['categoryId', 'ownerType'].map((name) => [name, url.searchParams.get(name)]).filter(([, value]) => value);
    const items = table
      .filter((record) => (!search || record.name.toLowerCase().includes(search) || record[key].toLowerCase().includes(search)) && (active === null || String(record.active) === active) && filters.every(([name, value]) => record[name] === value))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    return { body: { items: items.slice((page - 1) * limit, page * limit).map(withCategory), page, limit, total: items.length } };
  }
  if (method === 'POST' && !id) {
    const value = String(body[key] ?? '').trim();
    if (key === 'code' ? !/^[A-Z0-9][A-Z0-9_]{1,39}$/.test(value.toUpperCase().replace(/[\s-]+/g, '_')) : !/^[a-z0-9][a-z0-9-]{1,59}$/.test(value)) {
      return { status: 422, body: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid.', details: { fields: { [key]: [`${key} format is invalid`] } } } };
    }
    if (table.some((record) => record[key].toLowerCase() === value.toLowerCase())) return conflict(key);
    if (table.some((record) => record.name.toLowerCase() === String(body.name).trim().toLowerCase())) return conflict('name');
    const created = row({ ...body, [key]: key === 'code' ? value.toUpperCase().replace(/[\s-]+/g, '_') : value, name: String(body.name).trim() });
    table.push(created);
    return { body: withCategory(created) };
  }
  const record = table.find((item) => item.id === id);
  if (!record) return { status: 404, body: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } };
  if (method === 'GET') return { body: withCategory(record) };
  if (method === 'PATCH') {
    if (body.name && table.some((item) => item.id !== id && item.name.toLowerCase() === String(body.name).trim().toLowerCase())) return conflict('name');
    Object.assign(record, body, { updatedAt: new Date().toISOString() });
    return { body: withCategory(record) };
  }
  return null;
}

const readBody = (request) => new Promise((resolve) => {
  let data = '';
  request.on('data', (chunk) => { data += chunk; });
  request.on('end', () => resolve(data ? JSON.parse(data) : {}));
});

createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Facility-Id, X-Request-Id');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (request.method === 'OPTIONS') return response.writeHead(204).end();
  const url = new URL(request.url, 'http://x');
  const masterResult = masterRoute(request.method, url.pathname, url, request.method === 'GET' ? {} : await readBody(request));
  if (masterResult) {
    response.writeHead(masterResult.status ?? 200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify(masterResult.body));
  }
  const handler = routes[`${request.method} ${url.pathname}`];
  if (!handler) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not mocked in preview.' }));
  }
  const body = handler();
  if (body === null) return response.writeHead(204).end();
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}).listen(4000, () => console.log(`Preview mock API (${role}) on http://localhost:4000 — fixtures only`));
