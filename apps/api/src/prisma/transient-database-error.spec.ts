import { Prisma } from '@prisma/client';
import { retryDatabaseRead, transientDatabaseCode } from './transient-database-error';

const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('sensitive connection diagnostics', { code, clientVersion: 'test' });

describe('transient database classification', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])('recognizes transport/pool code %s', (code) => {
    expect(transientDatabaseCode(dbError(code))).toBe(code);
  });
  it.each(['P1000', 'P2002', 'P2025', 'P2028', 'P2034', 'P2021'])('does not classify non-transport code %s for read retry', (code) => {
    expect(transientDatabaseCode(dbError(code))).toBeUndefined();
  });
  it('recognizes Prisma initialization and explicitly reported closed connections only', () => {
    expect(transientDatabaseCode(new Prisma.PrismaClientInitializationError('hidden diagnostics', 'test', 'P1001'))).toBe('P1001');
    expect(transientDatabaseCode(new Prisma.PrismaClientUnknownRequestError('Server has closed the connection.', { clientVersion: 'test' }))).toBe('DB_CONNECTION_CLOSED');
    expect(transientDatabaseCode(new Error('Server has closed the connection.'))).toBeUndefined();
  });
});

describe('bounded database read retry', () => {
  it('recovers a transient read without disconnecting other requests or invoking it indefinitely', async () => {
    const read = jest.fn().mockRejectedValueOnce(dbError('P1017')).mockRejectedValueOnce(dbError('P1001')).mockResolvedValue('document');
    await expect(retryDatabaseRead(read)).resolves.toBe('document');
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('propagates persistent failure after three attempts', async () => {
    const error = dbError('P1017');
    const read = jest.fn().mockRejectedValue(error);
    await expect(retryDatabaseRead(read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('does not retry validation/schema errors or arbitrary node errors', async () => {
    for (const error of [dbError('P2002'), dbError('P2021'), new Error('EACCES')]) {
      const read = jest.fn().mockRejectedValue(error);
      await expect(retryDatabaseRead(read)).rejects.toBe(error);
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
});
