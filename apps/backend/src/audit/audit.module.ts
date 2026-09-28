import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditAdminController } from './audit-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';

// ─── Audit module ───────────────────────────────────────────────────────────
// A standalone module rather than part of OrgModule: every other admin
// surface is registered there because its subject is an organization, but
// this one's subject is the platform's own audit record, which spans admin
// actions on requests, organizations, and site admins themselves. See
// audit.service.ts's header for the full reasoning.
//
// Deliberately a leaf: PrismaModule is the only import, and AuditService is
// exported so other modules can read the audit record without going
// through the HTTP layer (the analytics dashboard is one such consumer,
// though it may well want its own aggregation queries instead).
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  controllers: [AuditAdminController],
  exports: [AuditService],
})
export class AuditModule {}
