import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
// EDIT (Phase 2 — subphase 2.3): OrgRequestsService registered here rather
// than in a module of its own. It lives in the organization domain, needs the
// same PrismaModule, and 2.4's approve() reuses org.service.ts's org-creation
// transaction shape. Exported so Phase 3.1's admin controller (which sits
// outside this module) can inject it without a second provider instance.
import { OrgRequestsService } from './org-requests.service';
// EDIT (Phase 4 — cutover, subphase 4.5): the four org-request lifecycle
// notifications (received/needs-info/approved/rejected). Its own provider,
// not folded into OrgRequestsService's own file, for the same reason
// OtpDeliveryService is split from OtpService — dispatch mechanics
// (SendGrid client, HTML templates) separate from the business logic that
// decides when to call them. Registered here rather than a new module:
// same reasoning as every other org-domain provider in this file (needs no
// import beyond PrismaModule/OtpModule already present), and its only
// consumer is OrgRequestsService, already in this module.
import { OrgRequestEmailService } from './org-request-email.service';
// EDIT (Phase 3 — admin portal core, subphase 3.2): OrgLifecycleService is
// service-only for this subphase (no controller yet — see its own header
// comment). Registered + exported now anyway, same reasoning as
// OrgRequestsService above: an unregistered provider is uninjectable, and
// 3.3's admin org-directory controller (and 3.6's suspend/reinstate UI
// behind it) will need to inject this exact instance.
import { OrgLifecycleService } from './org-lifecycle.service';
// EDIT (Phase 3 — admin portal core, subphase 3.3): read-only counterpart
// to OrgLifecycleService — see its own header comment for why it's a
// separate service from OrgService (domain separation: nothing here takes
// an org-member uid) and from OrgLifecycleService (read vs. write).
import { OrgDirectoryService } from './org-directory.service';
import { ScopeService } from './scope.service';
// EDIT (Phase 4 — cutover, subphase 4.1): OrgController now injects
// OrgRequestsService too (POST /org/request replaces POST /org/register —
// see org.controller.ts's own header comment on that route). No change
// needed to providers/controllers/exports below for this: OrgRequestsService
// has been a provider in this module since 2.3, and OrgController has always
// been in this same module, so the existing registration already covers it.
import { OrgController } from './org.controller';
// EDIT (Phase 3 — admin portal core, subphase 3.1): new admin controller,
// registered directly in this module (not exported — nothing outside this
// module needs to inject a controller) rather than a separate AdminModule.
// Same domain as OrgController, same OrgRequestsService instance the
// exports comment above already anticipated needing to be reachable from
// "outside this module" — turned out to mean "another controller in this
// same module," not a different one.
import { OrgRequestsAdminController } from './org-requests-admin.controller';
// EDIT (Phase 3 — admin portal core, subphase 3.3): second admin
// controller in this module, same reasoning as OrgRequestsAdminController
// above. See org-admin.controller.ts's own header comment for why it also
// carries the suspend/reinstate/archive routes, not just the directory
// endpoint this subphase's own plan entry names.
import { OrgAdminController } from './org-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
// EDIT (Phase 4 — cutover, subphase 4.3): OrgRequestsService now injects
// OtpService directly (sendDomainOtp() / submit()'s domain-ownership check)
// rather than going through auth.service.ts's own OtpService usage — same
// "import the module that provides it" pattern users.module.ts already
// uses for the same reason (see that file's own comment).
import { OtpModule } from '../otp/otp.module';

@Module({
  imports: [PrismaModule, OtpModule],
  providers: [
    OrgService,
    ScopeService,
    OrgRequestsService,
    OrgRequestEmailService,
    OrgLifecycleService,
    OrgDirectoryService,
  ],
  controllers: [OrgController, OrgRequestsAdminController, OrgAdminController],
  exports: [
    OrgService,
    ScopeService,
    OrgRequestsService,
    OrgLifecycleService,
    OrgDirectoryService,
  ],
})
export class OrgModule {}
