import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException, type ServerSideEncryption } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { assertStorageKey, readCapped, type StorageDriver, type StoredObject } from './storage-driver';

export type S3StorageOptions = {
  bucket: string;
  /** `auto` for Cloudflare R2; the bucket's region for AWS (e.g. `ap-southeast-3`, Jakarta). */
  region: string;
  /** Empty for AWS; `https://<account>.r2.cloudflarestorage.com` for R2; `http://localhost:9000` for MinIO. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO needs path-style URLs (`endpoint/bucket/key`). */
  forcePathStyle?: boolean;
  /** Optional key prefix inside the bucket, e.g. `nakes`. */
  prefix?: string;
  /** `AES256` asks AWS for server-side encryption; R2 always encrypts at rest, MinIO needs a KMS for it. */
  serverSideEncryption?: ServerSideEncryption;
};

/**
 * S3-compatible object storage: AWS S3, Cloudflare R2, and MinIO through one client. The bucket must stay private
 * (no public access, no public bucket URL); objects are only read by the API and served through signed links.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions, client?: S3Client) {
    this.client = client ?? new S3Client({
      region: options.region,
      endpoint: options.endpoint || undefined,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  /** Size and content checks run on the buffered bytes before anything is sent to the bucket. */
  async write(key: string, source: Readable, maxBytes: number): Promise<StoredObject> {
    const { body, ...stored } = await readCapped(source, maxBytes);
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: this.objectKey(key),
      Body: body,
      ContentLength: body.length,
      ContentType: 'application/octet-stream',
      ...(this.options.serverSideEncryption ? { ServerSideEncryption: this.options.serverSideEncryption } : {}),
    }));
    return stored;
  }

  async read(key: string): Promise<Readable> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(key) }));
    if (!object.Body) throw new Error('Object has no body');
    return object.Body as Readable;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(key) }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound')) return false;
      throw error;
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(key) }));
  }

  private objectKey(key: string) {
    assertStorageKey(key);
    return this.options.prefix ? `${this.options.prefix.replace(/\/+$/, '')}/${key}` : key;
  }
}
