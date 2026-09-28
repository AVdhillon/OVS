import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
// OrgRequestsService is registered here rather than in a module of its
// own. It lives in the organization domain, needs the same PrismaModule,
// and approve() reuses org.service.ts's org-creation transaction shape.
// Exported so the admin controller (which sits outside this module) can
// inject it without a second provider instance.
import { OrgRequestsService } from './org-requests.service';
// Sends the four org-request lifecycle notifications
// (received/needs-info/approved/rejected). Its own provider,
// not folded into OrgRequestsService's own file, for the same reason
// OtpDeliveryService is split from OtpService — dispatch mechanics
// (SendGrid client, HTML templates) separate from the business logic that
// decides when to call them. Registered here rather than a new module:
// same reasoning as every other org-domain provider in this file (needs no
// import beyond PrismaModule/OtpModule already present), and its only
// consumer is OrgRequestsService, already in this module.
import { OrgRequestEmailService } from './org-request-email.service';
// OrgLifecycleService is registered and exported for the same reason as
// OrgRequestsService above: an unregistered provider is uninjectable, and
// the admin org-directory controller (and the suspend/reinstate UI
// behind it) need to inject this exact instance.
import { OrgLifecycleService } from './org-lifecycle.service';
// Read-only counterpart to OrgLifecycleService — see its own header
// comment for why it's a separate service from OrgService (domain
// separation: nothing here takes an org-member uid) and from
// OrgLifecycleService (read vs. write).
import { OrgDirectoryService } from './org-directory.service';
import { ScopeService } from './scope.service';
// OrgController injects OrgRequestsService too (POST /org/request replaces
// POST /org/register — see org.controller.ts's own header comment on that
// route). Both are already providers in this module, so no additional
// registration is needed for that dependency.
import { OrgController } from './org.controller';
// Admin controller, registered directly in this module (not exported —
// nothing outside this module needs to inject a controller) rather than a
// separate AdminModule. Same domain as OrgController, same
// OrgRequestsService instance already registered above.
import { OrgRequestsAdminController } from './org-requests-admin.controller';
// Second admin controller in this module, same reasoning as
// OrgRequestsAdminController above. See org-admin.controller.ts's own
// header comment for why it also carries the suspend/reinstate/archive
// routes, not just the directory endpoint.
import { OrgAdminController } from './org-admin.controller';
// Third admin controller in this module, same "no separate AdminModule"
// reasoning as OrgRequestsAdminController/OrgAdminController above.
// AdminReviewQueueService is registered as its own provider (not folded
// into OrgRequestsService) — see that file's own header comment for why.
import { AdminReviewQueueController } from './admin-review-queue.controller';
import { AdminReviewQueueService } from './admin-review-queue.service';
// Its own provider, not folded into OrgRequestsService — see that
// file's own header comment for why the two request kinds stay separate all
// the way down. Both OrgController (requester-facing submit/
// listForOrg routes) and MemberLimitRequestsAdminController below
// inject this same instance. Depends on OrgService
// (assertOrganizerAccess() for submit()'s organizer pre-check), already a
// provider in this module.
import { OrgLimitRequestsService } from './org-limit-requests.service';
// Sends the submitted/approved/rejected/needs-info notifications for this
// table's lifecycle. Its own provider, not folded into
// OrgLimitRequestsService's own file — same OrgRequestsService/
// OrgRequestEmailService split this module already registers above,
// applied to the sibling request kind. Its only consumer is
// OrgLimitRequestsService, already a provider in this module.
import { OrgLimitRequestEmailService } from './org-limit-request-email.service';
// Admin-facing counterpart to
// OrgRequestsAdminController, registered the same "no separate AdminModule"
// way as the other admin controllers in this module. See that file's
// own header comment for why it's a separate controller rather than new
// routes on OrgRequestsAdminController.
import { MemberLimitRequestsAdminController } from './member-limit-requests-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
// OrgRequestsService injects OtpService directly (sendDomainOtp() /
// submit()'s domain-ownership check) — same "import the module that
// provides it" pattern users.module.ts uses for the same reason (see that
// file's own comment).
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
    AdminReviewQueueService,
    OrgLimitRequestsService,
    OrgLimitRequestEmailService,
  ],
  controllers: [
    OrgController,
    OrgRequestsAdminController,
    OrgAdminController,
    AdminReviewQueueController,
    MemberLimitRequestsAdminController,
  ],
  exports: [
    OrgService,
    ScopeService,
    OrgRequestsService,
    OrgLifecycleService,
    OrgDirectoryService,
    OrgLimitRequestsService,
  ],
})
export class OrgModule {}
