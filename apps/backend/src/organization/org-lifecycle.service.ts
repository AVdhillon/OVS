import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrgLifecycleReasonDto } from './dto/org-lifecycle.dto';

// ─── Organization lifecycle (Phase 3 — admin portal core) ─────────────────
// EDIT (Phase 3 — admin portal core, subphase 3.2): new service.
//
// `organization.status` (added in 2.1) has three values — ACTIVE, SUSPENDED,
// ARCHIVED — described in the master schema's own comment on the column:
// SUSPENDED is reversible (a site admin can reinstate), ARCHIVED is
// terminal. `is_active` is a GENERATED column derived from `status`
// (`status = 'ACTIVE'`), so every method below writes `status` only — never
// `is_active` directly, which Postgres rejects outright (see 2.1's note,
// and org-creation.utilities.ts's `createOrganizationCore()`, which made
// the same fix for org creation).
//
// This subphase is service-only, per the plan's own file list — no
// controller routes are wired here. 3.3 builds the admin org-directory
// controller/endpoint these three methods are expected to be called from
// (alongside 3.6's suspend/reinstate detail-page UI), so the service is
// registered + exported from OrgModule now so that controller can inject
// it without a second provider instance, mirroring 2.3's own note that an
// unregistered provider is uninjectable.
//
// Locking shape is copied directly from OrgRequestsService's
// approve()/reject()/requestInfo() (2.4/2.5): a fast, unlocked pre-check for
// a friendly 404/409 (does NOT close the race), then — inside a
// transaction — `SELECT ... FOR UPDATE` on the organization row itself
// before the UPDATE, so two admins racing to suspend/reinstate/archive the
// same org serialize against each other instead of one silently
// clobbering the other's write. organization.orgid is the table's own PK
// (VARCHAR, not BIGSERIAL like org_requests.request_id), but the shape is
// otherwise identical.
//
// requireActiveSiteAdmin() below is a straight copy of
// OrgRequestsService's private method of the same name, not a shared
// import — there is no shared "admin utilities" module anywhere in this
// codebase yet (auth.service.ts's own two site_admins lookups are inline,
// not extracted either), so introducing one here would be a wider
// refactor than this subphase asks for. Same defense-in-depth reasoning
// as approve()'s: SiteAdminGuard only checks site_admins.is_active at
// login time, and suspending/archiving an organization is exactly the
// kind of adverse, irreversible-or-hard-to-reverse action worth re-
// checking for, the same way approve() does before creating one.

type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

@Injectable()
export class OrgLifecycleService {
  constructor(private prisma: PrismaService) {}

  // ─── Suspend ────────────────────────────────────────────────────────────
  // ACTIVE -> SUSPENDED only. Reversible via reinstate(). `reason` is
  // required — chk_admin_audit_reason_required makes admin_audit_log.reason
  // NOT NULL for ORG_SUSPENDED, and a suspension with no stated reason is a
  // bad admin-audit trail even where the DB wouldn't otherwise force one.
  async suspend(orgid: string, adminId: string, dto: OrgLifecycleReasonDto) {
    await this.requireActiveSiteAdmin(adminId);
    const reason = this.requireReason(
      dto,
      'A reason is required to suspend an organization.',
    );

    const pre = await this.prisma.organization.findUnique({
      where: { orgid },
    });
    if (!pre) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }
    this.assertTransition(pre.status as OrgStatus, 'SUSPENDED', orgid);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ orgid: string; org_name: string; status: string }>
      >`
        SELECT orgid, org_name, status
        FROM organization
        WHERE orgid = ${orgid}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Organization ${orgid} not found`);
      }
      this.assertTransition(claimed.status as OrgStatus, 'SUSPENDED', orgid);

      const updated = await tx.organization.update({
        where: { orgid },
        data: { status: 'SUSPENDED' },
        select: { orgid: true, org_name: true, status: true },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_SUSPENDED',
          target_type: 'ORGANIZATION',
          target_id: orgid,
          reason,
          metadata: {
            org_name: claimed.org_name,
            previous_status: claimed.status,
          },
        },
      });

      return updated;
    });

    return {
      ...result,
      message: `Organization ${result.org_name} (${orgid}) has been suspended.`,
    };
  }

  // ─── Reinstate ──────────────────────────────────────────────────────────
  // SUSPENDED -> ACTIVE only. `reason` is optional — ORG_REINSTATED is
  // deliberately absent from chk_admin_audit_reason_required's list (the
  // schema's own comment on that CHECK groups it with approvals: reversing
  // an adverse action doesn't need the same forced justification the
  // adverse action itself did). If given, it's still validated/stored the
  // same way; if omitted, admin_audit_log.reason is written NULL, which the
  // CHECK constraint permits for this action.
  async reinstate(orgid: string, adminId: string, dto?: OrgLifecycleReasonDto) {
    await this.requireActiveSiteAdmin(adminId);
    const reason = this.resolveOptionalReason(dto);

    const pre = await this.prisma.organization.findUnique({
      where: { orgid },
    });
    if (!pre) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }
    this.assertTransition(pre.status as OrgStatus, 'ACTIVE', orgid);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ orgid: string; org_name: string; status: string }>
      >`
        SELECT orgid, org_name, status
        FROM organization
        WHERE orgid = ${orgid}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Organization ${orgid} not found`);
      }
      this.assertTransition(claimed.status as OrgStatus, 'ACTIVE', orgid);

      const updated = await tx.organization.update({
        where: { orgid },
        data: { status: 'ACTIVE' },
        select: { orgid: true, org_name: true, status: true },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_REINSTATED',
          target_type: 'ORGANIZATION',
          target_id: orgid,
          reason,
          metadata: {
            org_name: claimed.org_name,
            previous_status: claimed.status,
          },
        },
      });

      return updated;
    });

    return {
      ...result,
      message: `Organization ${result.org_name} (${orgid}) has been reinstated.`,
    };
  }

  // ─── Archive ────────────────────────────────────────────────────────────
  // ACTIVE or SUSPENDED -> ARCHIVED. Terminal — the master schema's own
  // comment on `organization.status` says so explicitly ("ARCHIVED —
  // permanently retired by a site admin; terminal"), and assertTransition()
  // below enforces it: there is no path back to ACTIVE or SUSPENDED once a
  // org is ARCHIVED, and archiving an already-ARCHIVED org is rejected
  // rather than treated as a no-op, so a caller can't be misled into
  // thinking a second archive did anything. `reason` is required, same as
  // suspend() — ORG_ARCHIVED is in chk_admin_audit_reason_required's list,
  // and it's the more consequential of the two adverse actions.
  async archive(orgid: string, adminId: string, dto: OrgLifecycleReasonDto) {
    await this.requireActiveSiteAdmin(adminId);
    const reason = this.requireReason(
      dto,
      'A reason is required to archive an organization.',
    );

    const pre = await this.prisma.organization.findUnique({
      where: { orgid },
    });
    if (!pre) {
      throw new NotFoundException(`Organization ${orgid} not found`);
    }
    this.assertTransition(pre.status as OrgStatus, 'ARCHIVED', orgid);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ orgid: string; org_name: string; status: string }>
      >`
        SELECT orgid, org_name, status
        FROM organization
        WHERE orgid = ${orgid}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Organization ${orgid} not found`);
      }
      this.assertTransition(claimed.status as OrgStatus, 'ARCHIVED', orgid);

      const updated = await tx.organization.update({
        where: { orgid },
        data: { status: 'ARCHIVED' },
        select: { orgid: true, org_name: true, status: true },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_ARCHIVED',
          target_type: 'ORGANIZATION',
          target_id: orgid,
          reason,
          metadata: {
            org_name: claimed.org_name,
            previous_status: claimed.status,
          },
        },
      });

      return updated;
    });

    return {
      ...result,
      message: `Organization ${result.org_name} (${orgid}) has been archived. This cannot be undone.`,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Same defense-in-depth check as OrgRequestsService.approve() — see this
   * file's header comment for why it's duplicated rather than shared, and
   * that method's own comment for why the guard alone isn't enough.
   */
  private async requireActiveSiteAdmin(adminId: string) {
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!admin || !admin.is_active) {
      throw new ForbiddenException(
        'This admin account is not active. Please sign in again.',
      );
    }
  }

  /**
   * Enforces the transitions the schema's own comment on `organization.
   * status` describes: ACTIVE <-> SUSPENDED is reversible either direction,
   * ARCHIVED is terminal and reachable from either ACTIVE or SUSPENDED. A
   * same-state "transition" (e.g. suspend() on an already-SUSPENDED org) is
   * rejected rather than treated as a silent no-op, so a caller always
   * knows whether their call actually changed anything.
   */
  private assertTransition(
    current: OrgStatus,
    target: Exclude<OrgStatus, never>,
    orgid: string,
  ) {
    if (current === target) {
      throw new ConflictException(
        `Organization ${orgid} is already ${target}.`,
      );
    }
    if (current === 'ARCHIVED') {
      throw new ConflictException(
        `Organization ${orgid} is archived, which is terminal — it cannot be ${
          target === 'ACTIVE' ? 'reinstated' : 're-suspended'
        }.`,
      );
    }
    // Every remaining case — ACTIVE->SUSPENDED, SUSPENDED->ACTIVE,
    // ACTIVE->ARCHIVED, SUSPENDED->ARCHIVED — is a legal transition.
  }

  /** suspend()/archive()'s shared required-reason validation. */
  private requireReason(dto: OrgLifecycleReasonDto, message: string): string {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException(message);
    }
    return reason;
  }

  /** reinstate()'s optional-reason validation — trims if given, else null. */
  private resolveOptionalReason(dto?: OrgLifecycleReasonDto): string | null {
    const reason = dto?.reason?.trim();
    return reason && reason.length > 0 ? reason : null;
  }
}
