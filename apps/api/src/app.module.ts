import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessLogMiddleware } from './common/access-log.middleware';
import { AccessGuard } from './common/access/access.guard';
import { ErrorEnvelopeFilter } from './common/errors/error-envelope.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { HealthController } from './modules/health/health.controller';
import { OrdersModule } from './modules/orders/orders.module';
import { PractitionersModule } from './modules/practitioners/practitioners.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users-access/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Default limit for every route; login, refresh, and password reset set stricter ones (spec §10).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    DashboardModule,
    MasterDataModule,
    FacilitiesModule,
    PractitionersModule,
    CatalogModule,
    AvailabilityModule,
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, AccessLogMiddleware).forRoutes('*');
  }
}
