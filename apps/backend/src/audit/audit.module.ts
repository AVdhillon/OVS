import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditAdminController } from './audit-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';

// ─── Audit module (Phase 5 — platform maturity, subphase 5.1) ──────────────
// EDIT: new module. Every admin surface before this one (3.1, 3.3) was
// registered inside OrgModule because its subject was an organization; this
// one's subject is the platform's own audit record, which spans admin
// actions on requests, organizations and — once 5.3 lands — site admins
// themselves. See audit.service.ts's header for the full reasoning.
//
// Deliberately a leaf: PrismaModule is the only import, and AuditService is
// exported so a later subphase can read the audit record without going
// through the HTTP layer (5.2's analytics dashboard is the obvious
// candidate, though it may well want its own aggregation queries instead).
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  controllers: [AuditAdminController],
  exports: [AuditService],
})
export class AuditModule {}
