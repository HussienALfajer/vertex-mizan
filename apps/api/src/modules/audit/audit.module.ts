import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** The company audit log screen's API (S01 rules 23–26). */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
