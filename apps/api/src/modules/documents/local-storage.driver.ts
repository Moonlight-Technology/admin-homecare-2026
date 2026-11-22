import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { assertStorageKey, ObjectTooLargeError, type StorageDriver, type StoredObject } from './storage/storage-driver';

export { ObjectTooLargeError, type StoredObject } from './storage/storage-driver';

/**
 * Development storage on local disk. Files are not encrypted at rest and live on one machine only, so production
 * uses the `s3` or `cloudinary` driver (spec §10).
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  /** Streams to disk while hashing and counting; aborts and removes the file past `maxBytes`. */
  async write(key: string, source: Readable, maxBytes: number): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(new ObjectTooLargeError());
        if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(target, { flags: 'w', mode: 0o600 }));
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return { sizeBytes: size, sha256: hash.digest('hex'), head };
  }

  async read(key: string): Promise<Readable> {
    return createReadStream(this.path(key));
  }

  async exists(key: string) {
    return stat(this.path(key)).then(() => true, () => false);
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }

  /** Keys are generated server-side, but are still confined to the storage root. */
  private path(key: string) {
    assertStorageKey(key);
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return target;
  }
}
