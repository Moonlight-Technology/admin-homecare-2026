/**
 * Idempotent seed: permissions, system roles, the first platform super admin, and sample master data.
 * Master data values are illustrative starting points; operations confirms the real lists (spec §15).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PrismaClient, type MembershipScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { FACILITY_PERMISSIONS, PLATFORM_PERMISSIONS, SYSTEM_ROLES } from '../src/modules/users-access/permissions.catalog';

const prisma = new PrismaClient();

async function seedAccess() {
  const permissions: Array<{ code: string; scope: MembershipScope }> = [
    ...Object.values(PLATFORM_PERMISSIONS).map((code) => ({ code, scope: 'PLATFORM' as const })),
    ...Object.values(FACILITY_PERMISSIONS).map((code) => ({ code, scope: 'FACILITY' as const })),
  ];
  for (const permission of permissions) {
    await prisma.permission.upsert({ where: { code: permission.code }, update: { scope: permission.scope }, create: permission });
  }
  const byCode = new Map((await prisma.permission.findMany()).map((permission) => [permission.code, permission.id]));
  for (const role of SYSTEM_ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, scope: role.scope },
      create: { code: role.code, name: role.name, scope: role.scope },
    });
    // Built-in role permissions always match the catalog.
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({ data: role.permissions.map((code) => ({ roleId: saved.id, permissionId: byCode.get(code)! })) });
  }
}

async function seedSuperAdmin() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD not set; skipping the super admin.');
    return;
  }
  if (password.length < 12) throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'PLATFORM_SUPER_ADMIN' } });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Platform Super Admin', status: 'ACTIVE', passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
  const existing = await prisma.membership.findFirst({ where: { userId: user.id, roleId: role.id, scopeType: 'PLATFORM', active: true } });
  if (!existing) await prisma.membership.create({ data: { userId: user.id, roleId: role.id, scopeType: 'PLATFORM' } });
  console.log(`Super admin ready: ${email}`);
}

async function seedMasterData() {
  const upsertByCode = async <T extends { code: string }>(
    model: { upsert: (args: { where: { code: string }; update: object; create: T }) => Promise<unknown> },
    rows: T[],
  ) => {
    for (const row of rows) await model.upsert({ where: { code: row.code }, update: {}, create: row });
  };
  await upsertByCode(prisma.facilityType, [{ code: 'KLINIK', name: 'Klinik', sortOrder: 1 }]);
  await upsertByCode(prisma.clinicClass, [
    { code: 'PRATAMA', name: 'Klinik Pratama', sortOrder: 1 },
    { code: 'UTAMA', name: 'Klinik Utama', sortOrder: 2 },
  ]);
  await upsertByCode(prisma.capability, [
    { code: 'RAWAT_JALAN', name: 'Rawat jalan', sortOrder: 1 },
    { code: 'RAWAT_INAP', name: 'Rawat inap', sortOrder: 2 },
  ]);
  await upsertByCode(prisma.practitionerType, [
    { code: 'DOKTER', name: 'Dokter', sortOrder: 1 },
    { code: 'PERAWAT', name: 'Perawat', sortOrder: 2 },
    { code: 'BIDAN', name: 'Bidan', sortOrder: 3 },
    { code: 'ANALIS_LAB', name: 'Analis laboratorium', sortOrder: 4 },
  ]);
  for (const category of [
    { slug: 'laboratorium', name: 'Laboratorium', sortOrder: 1 },
    { slug: 'vaksinasi', name: 'Vaksinasi', sortOrder: 2 },
    { slug: 'konsultasi-fertilitas', name: 'Konsultasi & program fertilitas', sortOrder: 3 },
  ]) {
    await prisma.serviceCategory.upsert({ where: { slug: category.slug }, update: {}, create: category });
  }
  // Verification checklist starting point (spec §15: operations confirms the final list in Master Data).
  for (const requirement of [
    { code: 'IZIN_OPERASIONAL', ownerType: 'FACILITY' as const, name: 'Izin operasional klinik', description: 'Izin operasional yang masih berlaku dari Dinas Kesehatan.', mandatory: true, sortOrder: 1 },
    { code: 'NIB', ownerType: 'FACILITY' as const, name: 'Nomor Induk Berusaha (NIB)', description: 'Dokumen NIB dari OSS.', mandatory: true, sortOrder: 2 },
    { code: 'FOTO_KLINIK', ownerType: 'FACILITY' as const, name: 'Foto tampak depan klinik', description: null, mandatory: false, sortOrder: 3 },
  ]) {
    await prisma.documentRequirement.upsert({ where: { code: requirement.code }, update: {}, create: requirement });
  }
  // Clinics build their offerings on these; operations replaces them with the confirmed taxonomy.
  const categoryIds = new Map((await prisma.serviceCategory.findMany({ select: { id: true, slug: true } })).map((category) => [category.slug, category.id]));
  for (const service of [
    { code: 'LAB_DARAH_LENGKAP', name: 'Pemeriksaan darah lengkap', category: 'laboratorium' },
    { code: 'LAB_GULA_DARAH', name: 'Pemeriksaan gula darah', category: 'laboratorium' },
    { code: 'LAB_KOLESTEROL', name: 'Pemeriksaan kolesterol total', category: 'laboratorium' },
    { code: 'VAKSIN_INFLUENZA', name: 'Vaksinasi influenza', category: 'vaksinasi' },
    { code: 'VAKSIN_HEPATITIS_B', name: 'Vaksinasi hepatitis B', category: 'vaksinasi' },
    { code: 'KONSUL_FERTILITAS', name: 'Konsultasi program kehamilan', category: 'konsultasi-fertilitas' },
  ]) {
    const categoryId = categoryIds.get(service.category);
    if (categoryId) await prisma.masterService.upsert({ where: { code: service.code }, update: {}, create: { code: service.code, name: service.name, categoryId } });
  }
}

/**
 * All Indonesian regions down to villages (~91,600 rows, see prisma/data/REGIONS_NOTICE.md). Inserted in batches,
 * parents before children, skipping codes that already exist, so re-running is cheap and never renames regions.
 * Set SEED_REGIONS=false to skip.
 */
async function seedRegions() {
  if (process.env.SEED_REGIONS === 'false') {
    console.log('SEED_REGIONS=false; skipping regions.');
    return;
  }
  const lines = gunzipSync(readFileSync(join(__dirname, 'data', 'regions.tsv.gz'))).toString('utf8').split('\n').filter(Boolean);
  const existing = await prisma.region.count();
  if (existing >= lines.length) {
    console.log(`Regions already complete (${existing}).`);
    return;
  }
  const rows = lines.map((line) => {
    const [code, name] = line.split('\t') as [string, string];
    const parts = code.split('.');
    return { code, name, level: parts.length, parentCode: parts.length > 1 ? parts.slice(0, -1).join('.') : null };
  });
  const BATCH = 5000;
  let inserted = 0;
  // The file is sorted by level, so every batch's parents are already stored.
  for (let start = 0; start < rows.length; start += BATCH) {
    inserted += (await prisma.region.createMany({ data: rows.slice(start, start + BATCH), skipDuplicates: true })).count;
  }
  console.log(`Regions: ${inserted} added, ${rows.length - inserted} already present.`);
}

async function main() {
  await seedAccess();
  await seedSuperAdmin();
  await seedMasterData();
  await seedRegions();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
