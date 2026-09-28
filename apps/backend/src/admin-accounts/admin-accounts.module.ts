import { Module } from '@nestjs/common';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAccountsController } from './admin-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';

// ─── Admin accounts module ──────────────────────────────────────────────────
// A sibling of AuditModule and AnalyticsModule rather than a controller
// inside OrgModule — same reasoning those two give: this surface's subject
// is the platform's own admin roster (site_admins), not an organization, so
// it doesn't belong in the org domain module. Also deliberately not folded
// into AuditModule even though its two actions (ADMIN_INVITED/
// ADMIN_DEACTIVATED) are read back out through AuditService/
// AuditAdminController — this module *writes*
// admin_audit_log rows, AuditModule only ever *reads* them (it has no write
// path at all, per its own controller's header comment), and mixing a
// writer into a module whose entire point is being the read-only viewer
// would blur that boundary.
//
// Leaf module — PrismaModule is the only import, no other domain service is
// injected. AdminAccountsService is not exported: nothing outside this
// module needs to inject it (unlike OrgRequestsService/OrgLifecycleService,
// whose controllers — living in a different module — need to
// reach), since AdminAccountsController is registered in this same module.
@Module({
  imports: [PrismaModule],
  providers: [AdminAccountsService],
  controllers: [AdminAccountsController],
})
export class AdminAccountsModule {}
