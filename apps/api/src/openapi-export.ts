/**
 * Writes the OpenAPI contract to packages/api-contracts/openapi.json without a database.
 * Run from the compiled build (`pnpm openapi:export`): decorator metadata needs tsc, and preview mode
 * builds the module graph without instantiating providers, so Prisma never connects.
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ConfigModule validates the environment when AppModule is imported, so defaults go in first.
process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET ??= 'openapi-export-only-secret-not-used-at-runtime';
process.env.STORAGE_SIGNING_SECRET ??= 'openapi-export-only-storage-secret-not-used';
process.env.API_PUBLIC_URL ??= 'http://localhost:4000/api/v1';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'openapi-export-only-credential-key-not-used';

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { API_PREFIX, openApiDocument } = await import('./bootstrap');
  const { endpointReference } = await import('./common/openapi/documentation');
  const app = await NestFactory.create(AppModule, { logger: false, preview: true });
  app.setGlobalPrefix(API_PREFIX);
  const target = resolve(__dirname, '../../../packages/api-contracts/openapi.json');
  mkdirSync(resolve(target, '..'), { recursive: true });
  const document = openApiDocument(app);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  const docs = resolve(__dirname, '../../../docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(resolve(docs, 'API_ENDPOINTS.md'), endpointReference(document));
  console.log(`OpenAPI written to ${target}`);
  await app.close();
}

void main();
