// Concurrency check on real PostgreSQL: six transactions race for a slot with capacity 2; exactly two may win.
import { PrismaClient } from '@prisma/client';
import { AvailabilityService } from '../../src/modules/availability/availability.service';

const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.findFirstOrThrow({ where: { displayName: { startsWith: 'Klinik Smoke' } }, select: { id: true } });
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const day = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  await prisma.facilitySchedule.create({ data: { facilityId: facility.id, mode: 'ON_SITE', dayOfWeek: new Date(`${day}T00:00:00Z`).getUTCDay(), startTime: '14:00', endTime: '15:00', slotMinutes: 60, capacityPerSlot: 2 } });
  const startsAt = new Date(`${day}T14:00:00+07:00`);
  const availability = new AvailabilityService(prisma as never, { record: async () => undefined } as never);

  const results = await Promise.allSettled(Array.from({ length: 6 }, () => prisma.$transaction((tx) => availability.reserve(tx as never, { facilityId: facility.id, mode: 'ON_SITE', startsAt, durationMinutes: 30 }))));
  const won = results.filter((result) => result.status === 'fulfilled').length;
  const full = results.filter((result) => result.status === 'rejected' && (result.reason as { code?: string }).code === 'SLOT_FULL').length;
  const other = results.filter((result) => result.status === 'rejected' && (result.reason as { code?: string }).code !== 'SLOT_FULL').map((result) => String((result as PromiseRejectedResult).reason?.message ?? result));
  const slot = await prisma.facilitySlot.findUniqueOrThrow({ where: { facilityId_mode_startsAt: { facilityId: facility.id, mode: 'ON_SITE', startsAt } } });
  const lines = [
    `${won === 2 ? 'PASS' : 'FAIL'}  exactly 2 of 6 concurrent reservations win (got ${won})`,
    `${full === 4 ? 'PASS' : 'FAIL'}  the other 4 get SLOT_FULL (got ${full}${other.length ? `; other errors: ${other.join(' | ')}` : ''})`,
    `${slot.reserved === 2 && slot.capacity === 2 ? 'PASS' : 'FAIL'}  the stored slot shows reserved 2 of 2 (got ${slot.reserved}/${slot.capacity})`,
  ];
  await prisma.$transaction((tx) => availability.release(tx as never, slot.id));
  const released = await prisma.facilitySlot.findUniqueOrThrow({ where: { id: slot.id } });
  lines.push(`${released.reserved === 1 ? 'PASS' : 'FAIL'}  release gives one place back (got ${released.reserved})`);
  const blocked = await prisma.$transaction((tx) => availability.reserve(tx as never, { facilityId: facility.id, mode: 'ON_SITE', startsAt: new Date(`${day}T15:00:00+07:00`), durationMinutes: 30 })).then(() => 'reserved', (error: { code?: string }) => error.code);
  lines.push(`${blocked === 'SLOT_UNAVAILABLE' ? 'PASS' : 'FAIL'}  a time outside the schedule cannot be reserved (got ${blocked})`);
  console.log(lines.join('\n'));
  if (lines.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
}

main()
  .catch((error) => { console.error('FAIL  race check crashed', error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
