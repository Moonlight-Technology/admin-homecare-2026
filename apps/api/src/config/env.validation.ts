import { notificationConfig } from '../modules/notifications/notification.config';

/** Fails fast at boot when required configuration is missing or unsafe. */
export function validateEnv(env: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'WEB_ORIGIN', 'JWT_ACCESS_SECRET', 'STORAGE_SIGNING_SECRET', 'API_PUBLIC_URL', 'CREDENTIAL_ENCRYPTION_KEY'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  if (String(env.JWT_ACCESS_SECRET).length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
  if (String(env.STORAGE_SIGNING_SECRET).length < 32) throw new Error('STORAGE_SIGNING_SECRET must be at least 32 characters.');
  if (env.STORAGE_SIGNING_SECRET === env.JWT_ACCESS_SECRET) throw new Error('STORAGE_SIGNING_SECRET must differ from JWT_ACCESS_SECRET.');
  if (String(env.CREDENTIAL_ENCRYPTION_KEY).length < 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.');
  if ([env.JWT_ACCESS_SECRET, env.STORAGE_SIGNING_SECRET].includes(env.CREDENTIAL_ENCRYPTION_KEY)) throw new Error('CREDENTIAL_ENCRYPTION_KEY must differ from the other secrets.');
  if (env.BOOKINGS_API_KEY && String(env.BOOKINGS_API_KEY).length < 32) throw new Error('BOOKINGS_API_KEY must be at least 32 characters (or empty to disable bookings).');
  const storageDriver = String(env.STORAGE_DRIVER || 'local');
  const expiryMode = String(env.ORDER_APPROVAL_EXPIRY_MODE || 'off');
  if (!['off', 'after_creation', 'at_visit'].includes(expiryMode)) throw new Error('ORDER_APPROVAL_EXPIRY_MODE must be off, after_creation, or at_visit.');
  const expiryMinutes = Number(env.ORDER_APPROVAL_EXPIRY_MINUTES || 0);
  if (!Number.isInteger(expiryMinutes) || expiryMinutes < 0 || expiryMinutes > 525600 || (expiryMode === 'after_creation' && expiryMinutes < 1)) throw new Error('ORDER_APPROVAL_EXPIRY_MINUTES must be a positive integer (1–525600) for after_creation.');
  const storageSettings: Record<string, string[]> = {
    local: [],
    minio: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    s3: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  };
  if (!(storageDriver in storageSettings)) throw new Error(`STORAGE_DRIVER must be one of: ${Object.keys(storageSettings).join(', ')}.`);
  const missingStorage = storageSettings[storageDriver]!.filter((key) => !env[key]);
  if (missingStorage.length) throw new Error(`STORAGE_DRIVER=${storageDriver} needs: ${missingStorage.join(', ')}`);
  if (storageDriver === 'minio') {
    let endpoint: URL;
    try { endpoint = new URL(String(env.S3_ENDPOINT)); } catch { throw new Error('S3_ENDPOINT must be an absolute http(s) URL for MinIO.'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
      throw new Error('S3_ENDPOINT must be a MinIO http(s) origin without credentials, path, query, or fragment.');
    }
    if (env.S3_FORCE_PATH_STYLE !== undefined && env.S3_FORCE_PATH_STYLE !== '' && String(env.S3_FORCE_PATH_STYLE) !== 'true') throw new Error('MinIO requires S3_FORCE_PATH_STYLE=true.');
  }
  // Local disk is unencrypted and lives on one machine; production documents belong in object storage (spec §10).
  if (env.NODE_ENV === 'production' && storageDriver === 'local') throw new Error('STORAGE_DRIVER=local is for development only; use minio in production (see docs/MINIO_DEPLOYMENT.md).');
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE must be true in production.');
  return {
    ...env,
    ...notificationConfig(env),
    PORT: Number(env.PORT ?? 4000),
    JWT_ACCESS_TTL_SECONDS: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
    REFRESH_TOKEN_TTL_DAYS: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 14),
    PASSWORD_RESET_TTL_MINUTES: Number(env.PASSWORD_RESET_TTL_MINUTES ?? 30),
    INVITATION_TTL_HOURS: Number(env.INVITATION_TTL_HOURS ?? 72),
    DOCUMENT_URL_TTL_SECONDS: Number(env.DOCUMENT_URL_TTL_SECONDS ?? 300),
    STORAGE_DRIVER: storageDriver,
    ORDER_APPROVAL_EXPIRY_MODE: expiryMode,
    ORDER_APPROVAL_EXPIRY_MINUTES: expiryMinutes,
    ...(storageDriver === 'minio' ? { S3_REGION: String(env.S3_REGION || 'us-east-1'), S3_FORCE_PATH_STYLE: 'true' } : {}),
    STORAGE_DIR: String(env.STORAGE_DIR ?? './storage'),
    COOKIE_SECURE: env.COOKIE_SECURE === 'true',
  };
}
