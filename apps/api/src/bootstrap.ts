import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { validationException } from './common/errors/validation';
import { completeOpenApiDocument } from './common/openapi/documentation';

export const API_PREFIX = 'api/v1';

/** Shared by `main.ts` and the OpenAPI export so both describe the same API. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_ORIGIN'),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Facility-Id'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationException,
    }),
  );
}

export function openApiDocument(app: INestApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('Nakes Admin API')
    .setDescription([
      'API untuk Platform Admin, Clinic Admin, dan integrasi booking Nakes.',
      'Semua path sudah menyertakan /api/v1; server URL menggunakan origin tanpa prefix tersebut.',
      'Login melalui POST /api/v1/auth/login, lalu gunakan accessToken pada Authorize → bearer.',
      'Booking memakai BOOKINGS_API_KEY pada Authorize → bookingKey (bukan JWT admin).',
      'Refresh/logout memakai cookie HTTP-only nakes_rt dan Origin yang sama dengan WEB_ORIGIN.',
      'Endpoint clinic menerima X-Facility-Id untuk memilih membership klinik sendiri.',
      'Respons sukses dikembalikan langsung, tanpa envelope data/success. List memakai items/page/limit/total.',
      'Error memakai { code, message, details?, requestId? }; validasi DTO menghasilkan 422.',
      'Permission berasal dari decorator akses dan dicantumkan pada x-access serta deskripsi operasi.',
      'Panduan integrasi: docs/SWAGGER.md. Daftar endpoint: docs/API_ENDPOINTS.md.',
    ].join('\n\n'))
    .setVersion('1.0')
    .addBearerAuth()
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Server-to-server BOOKINGS_API_KEY. Jangan gunakan JWT admin.' }, 'bookingKey')
    .addCookieAuth('nakes_rt', { type: 'apiKey', in: 'cookie', description: 'Cookie HTTP-only dari login; browser mengelolanya otomatis.' }, 'refreshCookie')
    .addServer('/', 'Current API origin (paths include /api/v1)')
    .build();
  return completeOpenApiDocument(SwaggerModule.createDocument(app, options));
}
