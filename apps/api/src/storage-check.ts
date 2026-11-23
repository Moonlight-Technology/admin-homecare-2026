/** Explicit deploy smoke check: touches only a random probe object, never document rows or existing objects. */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { createStorageDriver } from './modules/documents/storage/create-storage-driver';

export async function checkMinioStorage(env: Record<string, unknown>) {
  if (env.STORAGE_DRIVER !== 'minio') throw new Error('Set STORAGE_DRIVER=minio before running this check. Other backends will not be touched.');
  const config = new ConfigService(validateEnv(env));
  const storage = createStorageDriver(config);
  const key = `storage-check/${randomUUID()}/probe`;
  const content = Buffer.from('Nakes MinIO storage connectivity probe\n');
  let written = false;
  try {
    const stored = await storage.write(key, Readable.from([content]), content.length);
    written = true;
    if (stored.sizeBytes !== content.length || !await storage.exists(key)) throw new Error('PUT/HEAD check failed.');
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.read(key)) chunks.push(Buffer.from(chunk));
    if (!Buffer.concat(chunks).equals(content)) throw new Error('GET content does not match the uploaded bytes.');
    await storage.remove(key);
    written = false;
    if (await storage.exists(key)) throw new Error('DELETE check failed.');
    return { driver: 'minio', bucket: config.get<string>('S3_BUCKET'), checks: ['PUT', 'HEAD', 'GET byte comparison', 'DELETE'] };
  } finally {
    if (written) await storage.remove(key);
  }
}

if (require.main === module) {
  checkMinioStorage(process.env)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'MinIO storage check failed.'); process.exitCode = 1; });
}
