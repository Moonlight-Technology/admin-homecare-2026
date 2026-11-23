import { v2 as cloudinarySdk } from 'cloudinary';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { assertStorageKey, readCapped, type StorageDriver, type StoredObject } from './storage-driver';

export type CloudinaryStorageOptions = { cloudName: string; apiKey: string; apiSecret: string; folder: string };

/**
 * Cloudinary as a private document store. Every file is a `raw` asset (never transformed or rendered) of delivery
 * type `authenticated`: it has no public URL, and the signed URL used to fetch it stays on the server, which streams
 * the bytes through the API's own short-lived links. Cloudinary hosts data outside Indonesia; see README.
 */
export class CloudinaryStorageDriver implements StorageDriver {
  private static readonly asset = { resource_type: 'raw', type: 'authenticated' } as const;

  constructor(
    private readonly options: CloudinaryStorageOptions,
    private readonly sdk: typeof cloudinarySdk = cloudinarySdk,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.sdk.config({ cloud_name: options.cloudName, api_key: options.apiKey, api_secret: options.apiSecret, secure: true });
  }

  /** Size and content checks run on the buffered bytes before anything is uploaded. */
  async write(key: string, source: Readable, maxBytes: number): Promise<StoredObject> {
    const { body, ...stored } = await readCapped(source, maxBytes);
    const publicId = this.publicId(key);
    await new Promise<void>((resolve, reject) => {
      const upload = this.sdk.uploader.upload_stream(
        { ...CloudinaryStorageDriver.asset, public_id: publicId, overwrite: true, invalidate: true, use_filename: false, unique_filename: false },
        (error) => (error ? reject(new Error(`Cloudinary upload failed: ${error.message}`)) : resolve()),
      );
      upload.end(body);
    });
    return stored;
  }

  async read(key: string): Promise<Readable> {
    const url = this.sdk.url(this.publicId(key), { ...CloudinaryStorageDriver.asset, sign_url: true, secure: true });
    const response = await this.fetchImpl(url);
    if (!response.ok || !response.body) throw new Error(`Cloudinary download failed with HTTP ${response.status}`);
    return Readable.fromWeb(response.body as unknown as WebReadableStream);
  }

  async exists(key: string) {
    try {
      await this.sdk.api.resource(this.publicId(key), CloudinaryStorageDriver.asset);
      return true;
    } catch (error) {
      if ((error as { error?: { http_code?: number } }).error?.http_code === 404) return false;
      throw error;
    }
  }

  async remove(key: string) {
    await this.sdk.uploader.destroy(this.publicId(key), { ...CloudinaryStorageDriver.asset, invalidate: true });
  }

  private publicId(key: string) {
    assertStorageKey(key);
    return `${this.options.folder.replace(/\/+$/, '')}/${key}`;
  }
}
