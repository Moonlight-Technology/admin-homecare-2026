import { Global, Module } from '@nestjs/common';
import { OutboxService } from '../notifications/outbox.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, OutboxService],
  exports: [AuditService, OutboxService],
})
export class AuditModule {}
