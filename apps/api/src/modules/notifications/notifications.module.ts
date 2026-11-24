import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../../config/env.validation';
import { PrismaModule } from '../../prisma/prisma.module';
import { GmailSmtpAdapter } from './gmail-smtp.adapter';
import { NotificationRepository } from './notification.repository';
import { NotificationRouter } from './notification.router';
import { NotificationWorker } from './notification.worker';

/** Dedicated worker context only; not imported by AppModule, so API replicas cannot send mail. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), PrismaModule],
  providers: [GmailSmtpAdapter, NotificationRouter, NotificationRepository, NotificationWorker],
})
export class NotificationsModule {}
