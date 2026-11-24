import { Prisma } from '@prisma/client';

const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** Classify only database transport/pool failures; never auth, schema, validation or arbitrary filesystem errors. */
export function transientDatabaseCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return UNAVAILABLE_CODES.has(error.code) ? error.code : undefined;
  if (error instanceof Prisma.PrismaClientInitializationError) return error.errorCode && UNAVAILABLE_CODES.has(error.errorCode) ? error.errorCode : undefined;
  if (error instanceof Prisma.PrismaClientUnknownRequestError && /server has closed the connection|connection (?:was )?closed|connection reset by peer/i.test(error.message)) return 'DB_CONNECTION_CLOSED';
  return undefined;
}

/** Only for standalone idempotent reads, never transaction callbacks, writes, or a consumed upload stream. */
export async function retryDatabaseRead<T>(read: () => Promise<T>): Promise<T> {
  const delays = [100, 250];
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const delay = delays[attempt];
      if (!transientDatabaseCode(error) || delay === undefined) throw error;
      await new Promise((done) => setTimeout(done, delay));
    }
  }
}
