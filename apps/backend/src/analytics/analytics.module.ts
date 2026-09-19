import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsAdminController } from './analytics-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';

// ─── Analytics module (Phase 5 — platform maturity, subphase 5.2) ──────────
// EDIT: new module, a sibling of 5.1's AuditModule rather than part of it.
// Both are platform-level admin surfaces with no organization as their
// subject, but they are opposites in what they owe the reader: the audit
// viewer's value is per-row fidelity, this one's is that no individual row
// survives aggregation. See analytics.service.ts's header for the full
// reasoning, including the privacy rules that separation is meant to keep
// obvious.
//
// Leaf module, same shape as AuditModule: PrismaModule is the only import.
// AnalyticsService is exported on the same "a later subphase may want to
// read this without going through HTTP" basis, though nothing does yet.
@Module({
  imports: [PrismaModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsAdminController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
