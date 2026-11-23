import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import type { v2 as cloudinarySdk } from 'cloudinary';
import { Readable } from 'node:stream';
import { validateEnv } from '../../../config/env.validation';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { createStorageDriver } from './create-storage-driver';
import { ObjectTooLargeError, readCapped } from './storage-driver';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x20)]);
const text = async (stream: Readable) => { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); };

describe('readCapped', () => {
  it('returns the bytes with their size, hash, and first bytes', async () => {
    const stored = await readCapped(Readable.from([PDF.subarray(0, 4), PDF.subarray(4)]), 1024);
    expect(stored.body).toEqual(PDF);
    expect(stored.sizeBytes).toBe(PDF.length);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.head.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('stops past the cap', async () => {
    await expect(readCapped(Readable.from([Buffer.alloc(2048)]), 1024)).rejects.toBeInstanceOf(ObjectTooLargeError);
  });
});

describe('S3StorageDriver (AWS S3, Cloudflare R2, MinIO)', () => {
  function driver(respond: (command: unknown) => unknown = () => ({}), options: Partial<ConstructorParameters<typeof S3StorageDriver>[0]> = {}) {
    const sent: unknown[] = [];
    const client = { send: jest.fn(async (command: unknown) => { sent.push(command); return respond(command); }) } as unknown as S3Client;
    return { sent, storage: new S3StorageDriver({ bucket: 'docs', region: 'auto', accessKeyId: 'k', secretAccessKey: 's', prefix: 'nakes', ...options }, client) };
  }

  it('puts the checked bytes under the prefixed key, with server-side encryption when asked', async () => {
    const { storage, sent } = driver(undefined, { serverSideEncryption: 'AES256' });
    const stored = await storage.write('facility/f1/doc-1', Readable.from([PDF]), 1024);
    expect(stored.sizeBytes).toBe(PDF.length);
    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'docs', Key: 'nakes/facility/f1/doc-1', ContentLength: PDF.length, ServerSideEncryption: 'AES256' });
  });

  it('sends nothing when the file is too large', async () => {
    const { storage, sent } = driver();
    await expect(storage.write('facility/f1/big', Readable.from([Buffer.alloc(2048)]), 1024)).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(sent).toHaveLength(0);
  });

  it('reads the object body and answers exists from HEAD, treating 404 as absent', async () => {
    const notFound = new S3ServiceException({ name: 'NotFound', $fault: 'client', $metadata: { httpStatusCode: 404 } });
    const { storage } = driver((command) => {
      if (command instanceof GetObjectCommand) return { Body: Readable.from([PDF]) };
      if (command instanceof HeadObjectCommand && command.input.Key === 'nakes/facility/f1/missing') throw notFound;
      return {};
    });
    expect(await text(await storage.read('facility/f1/doc-1'))).toEqual(PDF);
    expect(await storage.exists('facility/f1/doc-1')).toBe(true);
    expect(await storage.exists('facility/f1/missing')).toBe(false);
  });

  it('refuses keys outside the generated format', async () => {
    const { storage } = driver();
    await expect(storage.read('../other-bucket')).rejects.toThrow('Invalid storage key');
  });
});

describe('CloudinaryStorageDriver', () => {
  function driver(overrides: { resource?: () => Promise<unknown>; fetchBody?: Buffer; fetchStatus?: number } = {}) {
    const uploads: Array<{ options: Record<string, unknown>; body: Buffer }> = [];
    const urls: Array<{ publicId: string; options: Record<string, unknown> }> = [];
    const sdk = {
      config: jest.fn(),
      url: jest.fn((publicId: string, options: Record<string, unknown>) => { urls.push({ publicId, options }); return `https://res.cloudinary.test/${publicId}?signed`; }),
      uploader: {
        upload_stream: jest.fn((options: Record<string, unknown>, callback: (error?: { message: string }) => void) => ({ end: (body: Buffer) => { uploads.push({ options, body }); callback(); } })),
        destroy: jest.fn(async () => ({ result: 'ok' })),
      },
      api: { resource: jest.fn(overrides.resource ?? (async () => ({}))) },
    } as unknown as typeof cloudinarySdk;
    const fetchImpl = jest.fn(async () => new Response(new Uint8Array(overrides.fetchBody ?? PDF), { status: overrides.fetchStatus ?? 200 })) as unknown as typeof fetch;
    return { uploads, urls, sdk, storage: new CloudinaryStorageDriver({ cloudName: 'c', apiKey: 'k', apiSecret: 's', folder: 'nakes' }, sdk, fetchImpl) };
  }

  it('uploads private raw assets of type authenticated under the folder', async () => {
    const { storage, uploads } = driver();
    await storage.write('facility/f1/doc-1', Readable.from([PDF]), 1024);
    expect(uploads[0]!.options).toMatchObject({ resource_type: 'raw', type: 'authenticated', public_id: 'nakes/facility/f1/doc-1' });
    expect(uploads[0]!.body).toEqual(PDF);
  });

  it('reads through a signed authenticated URL that stays on the server', async () => {
    const { storage, urls } = driver();
    expect(await text(await storage.read('facility/f1/doc-1'))).toEqual(PDF);
    expect(urls[0]).toMatchObject({ publicId: 'nakes/facility/f1/doc-1', options: { resource_type: 'raw', type: 'authenticated', sign_url: true } });
  });

  it('fails loudly on a download error instead of serving an empty file', async () => {
    const { storage } = driver({ fetchStatus: 401, fetchBody: Buffer.from('denied') });
    await expect(storage.read('facility/f1/doc-1')).rejects.toThrow('HTTP 401');
  });

  it('treats a 404 from the Admin API as absent', async () => {
    const { storage } = driver({ resource: async () => { throw { error: { http_code: 404 } }; } });
    expect(await storage.exists('facility/f1/doc-1')).toBe(false);
  });
});

describe('storage settings in env validation', () => {
  const base = { DATABASE_URL: 'postgresql://x', WEB_ORIGIN: 'http://localhost:3000', JWT_ACCESS_SECRET: 'j'.repeat(40), STORAGE_SIGNING_SECRET: 's'.repeat(40), API_PUBLIC_URL: 'http://localhost:4000/api/v1', CREDENTIAL_ENCRYPTION_KEY: 'c'.repeat(40) };

  it('defaults to local and rejects unknown drivers', () => {
    expect(validateEnv(base).STORAGE_DRIVER).toBe('local');
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'gdrive' })).toThrow('STORAGE_DRIVER must be one of');
  });

  it('names the settings a driver is missing', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'c' })).toThrow('CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b' })).toThrow('S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    expect(validateEnv({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }).STORAGE_DRIVER).toBe('s3');
  });

  it('refuses local disk in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' })).toThrow('development only');
  });

  it('selects the existing S3 driver for MinIO with path-style and region defaults', () => {
    const env = validateEnv({ ...base, STORAGE_DRIVER: 'minio', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'nakes-documents', S3_ACCESS_KEY_ID: 'app', S3_SECRET_ACCESS_KEY: 'secret' });
    expect(env.S3_FORCE_PATH_STYLE).toBe('true');
    expect(env.S3_REGION).toBe('us-east-1');
    expect(createStorageDriver(new ConfigService(env))).toBeInstanceOf(S3StorageDriver);
  });

  it('accepts MinIO in production and fails on missing endpoint or virtual-host addressing', () => {
    const minio = { ...base, STORAGE_DRIVER: 'minio', NODE_ENV: 'production', COOKIE_SECURE: 'true', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'nakes-documents', S3_ACCESS_KEY_ID: 'app', S3_SECRET_ACCESS_KEY: 'secret' };
    expect(validateEnv(minio).STORAGE_DRIVER).toBe('minio');
    expect(() => validateEnv({ ...minio, S3_ENDPOINT: '' })).toThrow('S3_ENDPOINT');
    expect(() => validateEnv({ ...minio, S3_FORCE_PATH_STYLE: 'false' })).toThrow('S3_FORCE_PATH_STYLE=true');
    expect(validateEnv({ ...minio, S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true' }).S3_REGION).toBe('us-east-1');
  });

  it.each(['ftp://minio:9000', 'http://user:password@minio:9000', 'http://minio:9000/bucket', 'http://minio:9000?key=secret', 'not-a-url'])('rejects invalid MinIO endpoint %s', (endpoint) => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'minio', S3_ENDPOINT: endpoint, S3_BUCKET: 'docs', S3_ACCESS_KEY_ID: 'app', S3_SECRET_ACCESS_KEY: 'secret' })).toThrow('S3_ENDPOINT');
  });
});
