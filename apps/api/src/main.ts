import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';

async function main() {
  const app = await NestFactory.create(AppModule);
  // Behind a proxy (load balancer) so request.ip is the client address used in audit logs and throttling.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  configureApp(app);
  const config = app.get(ConfigService);
  if (config.get('NODE_ENV') !== 'production') SwaggerModule.setup('api/docs', app, openApiDocument(app));
  app.enableShutdownHooks();
  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void main();
