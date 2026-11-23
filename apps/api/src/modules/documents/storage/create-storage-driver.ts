import type { ConfigService } from '@nestjs/config';
import { LocalStorageDriver } from '../local-storage.driver';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import type { StorageDriver } from './storage-driver';

export const STORAGE_DRIVERS = ['local', 'minio', 's3', 'cloudinary'] as const;
export type StorageDriverName = (typeof STORAGE_DRIVERS)[number];

/** Picks the driver from `STORAGE_DRIVER`; env validation has already checked that its settings are present. */
export function createStorageDriver(config: ConfigService): StorageDriver {
  const driver = config.get<StorageDriverName>('STORAGE_DRIVER', 'local');
  if (driver === 's3' || driver === 'minio') {
    return new S3StorageDriver({
      bucket: config.getOrThrow<string>('S3_BUCKET'),
      region: config.get<string>('S3_REGION') || (driver === 'minio' ? 'us-east-1' : 'auto'),
      endpoint: config.get<string>('S3_ENDPOINT') || undefined,
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE', driver === 'minio' ? 'true' : 'false') === 'true',
      prefix: config.get<string>('S3_PREFIX') || undefined,
      serverSideEncryption: config.get<string>('S3_SERVER_SIDE_ENCRYPTION') === 'AES256' ? 'AES256' : undefined,
    });
  }
  if (driver === 'cloudinary') {
    return new CloudinaryStorageDriver({
      cloudName: config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      apiKey: config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      apiSecret: config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      folder: config.get<string>('CLOUDINARY_FOLDER', 'nakes'),
    });
  }
  return new LocalStorageDriver(config.get<string>('STORAGE_DIR', './storage'));
}
