import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { DeactivateAdminDto } from './dto/deactivate-admin.dto';

// ─── Admin account management (Phase 5 — platform maturity, subphase 5.3) ──
// EDIT: new service.
//
// SUPER_ADMIN-only, per the plan's own subphase title. Enforced primarily
// at the controller level (@UseGuards(SiteAdminGuard) @RequireSuperAdmin()
// on every route in AdminAccountsController) — but every write method here
// also re-checks the *acting* admin's current is_active/is_super_admin
// state via requireActiveSuperAdmin() below, the same defense-in-depth
// duplication every write-path method since OrgRequestsService.approve()
// (2.4) has carried: SiteAdminGuard/SiteAdminJwtStrategy only verify
// site_admins state at *login* time (the JWT payload's is_super_admin is
// baked in then, per auth.service.ts's siteAdminLogin(), subphase 1.2), so
// a token issued before an admin was demoted or deactivated stays usable
// for the rest of that session. Inviting or deactivating other admin
// accounts is exactly the kind of action worth the extra query for — same
// reasoning OrgLifecycleService/OrgRequestsService already gave for
// organization-level actions.
//
// Two admin_audit_log actions, both already present in
// chk_admin_audit_action and chk_admin_audit_target_type ('SITE_ADMIN')
// since subphase 2.1 anticipated this subphase by name in its own schema
// comment — no schema change is needed for 5.3 at all. ADMIN_INVITED has an
// optional reason (chk_admin_audit_reason_required does not list it, same
// as ORG_REINSTATED); ADMIN_DEACTIVATED requires one (same list as
// ORG_SUSPENDED/ORG_ARCHIVED).
//
// No password field anywhere in this file — see InviteAdminDto's own
// header comment for why: admin login has always been OTP-to-email
// (auth.service.ts's resolveSiteAdminOtpIdentifier(), subphase 1.2), so
// inviteAdmin() only has to create the site_admins row; the invited person
// signs in through the existing admin-login flow immediately afterward,
// with no separate acceptance step or token.
//
// Locking shape mirrors OrgLifecycleService (3.2) exactly: a fast, unlocked
// pre-check for a friendly 404/409 (does not close a race on its own), then
// a `SELECT ... FOR UPDATE` inside the transaction before the write, so two
// concurrent actions on the same admin_id (e.g. two super admins racing to
// deactivate the same account) serialize instead of one silently
// clobbering the other.
//
// listAdmins()/getDetail() are a required deviation, the same class of gap
// 3.1/3.3/4.7 each already flagged and filled in their own subphase: the
// plan's file scope for 5.3 names only invite/deactivate, but a page that
// lets a super admin *choose* who to deactivate needs somewhere to read the
// roster from first, and nothing else in this codebase exposes one.

/**
 * Deliberately excludes 0/O/1/I from the generation alphabet — reduces
 * transcription mistakes when an admin_id is read aloud or copied by hand
 * (e.g. handed to a new admin over a call). chk_admin_id_format itself
 * still accepts the full [A-Z0-9]{4,20} range; this is just a friendlier
 * choice of what we generate, not a narrowing of what the column allows.
 */
const ADMIN_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADMIN_ID_SUFFIX_LENGTH = 6;
const MAX_ADMIN_ID_ATTEMPTS = 5;

function generateAdminId(): string {
  let suffix = '';
  for (let i = 0; i < ADMIN_ID_SUFFIX_LENGTH; i++) {
    suffix +=
      ADMIN_ID_ALPHABET[Math.floor(Math.random() * ADMIN_ID_ALPHABET.length)];
  }
  return `SA${suffix}`;
}

/**
 * True only for a collision on admin_id itself (the PK) — the case
 * inviteAdmin() should silently retry with a freshly generated id. A P2002
 * on site_admins.email/mobile is a different, genuine conflict (the
 * requested account already exists) and is reported to the caller instead,
 * not retried — see inviteAdmin()'s catch block. Mirrors
 * orgid.utilities.ts's isOrgIdUniqueConflict() one-for-one.
 */
function isAdminIdConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const targetStr = Array.isArray(target)
    ? target.join(',')
    : String(target ?? '');
  return (
    targetStr.includes('admin_id') || targetStr.includes('site_admins_pkey')
  );
}

@Injectable()
export class AdminAccountsService {
  constructor(private prisma: PrismaService) {}

  /**
   * The admin roster (the account-management page's table). No default
   * filter — same "a list that hides accounts by default isn't a roster"
   * reasoning AuditService.listAdminActions() gives for its own feed;
   * `isActive` narrows it when the caller wants only active or only
   * deactivated accounts.
   */
  async list(
    options: {
      isActive?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Same cap/reasoning as every other admin list endpoint since 3.1: this
    // is admin tooling, not a public export, but still capped so a caller
    // can't force one very expensive page.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;

    const where =
      options.isActive === undefined ? {} : { is_active: options.isActive };

    const [total, admins] = await this.prisma.$transaction([
      this.prisma.site_admins.count({ where }),
      this.prisma.site_admins.findMany({
        where,
        orderBy: [{ is_active: 'desc' }, { created_at: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { admins, total, page, page_size: pageSize };
  }

  /**
   * One admin account plus its own admin_audit_log trail — every
   * ADMIN_INVITED/ADMIN_DEACTIVATED action taken *on* this account (not
   * actions taken *by* it as a reviewer elsewhere in the system). Same
   * target-scoped, whole-history shape OrgDirectoryService.getDetail() and
   * OrgRequestsService.getDetail() already use for their own subjects.
   */
  async getDetail(adminId: string) {
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!admin) {
      throw new NotFoundException(`Admin account ${adminId} not found`);
    }
    const auditTrail = await this.prisma.admin_audit_log.findMany({
      where: { target_type: 'SITE_ADMIN', target_id: adminId },
      orderBy: { created_at: 'desc' },
    });
    return { ...admin, audit_trail: auditTrail };
  }

  /**
   * Creates a new site_admins row and writes ADMIN_INVITED. The invited
   * admin can sign in immediately — see this file's own header comment for
   * why there is no separate acceptance step.
   */
  async inviteAdmin(dto: InviteAdminDto, actingAdminId: string) {
    await this.requireActiveSuperAdmin(actingAdminId);

    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();
    const mobile = dto.mobile?.trim() || null;
    const isSuperAdmin = dto.is_super_admin ?? false;
    const reason = dto.reason?.trim() || null;

    // Fast, unlocked pre-check purely so the common case gets a message
    // naming the existing account — does not close a genuine race between
    // two simultaneous invites of the same email; site_admins.email's own
    // UNIQUE constraint is what actually closes that (caught below, same
    // "pre-check is for messaging only, the constraint is for correctness"
    // pattern every generated-id flow in this codebase already follows).
    const existing = await this.prisma.site_admins.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(
        `An admin account already exists for ${email} (${existing.admin_id}, ${
          existing.is_active ? 'active' : 'inactive'
        }).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let created:
        | Awaited<ReturnType<typeof tx.site_admins.create>>
        | undefined;

      for (let attempt = 0; attempt < MAX_ADMIN_ID_ATTEMPTS; attempt++) {
        const adminId = generateAdminId();
        try {
          created = await tx.site_admins.create({
            data: {
              admin_id: adminId,
              name,
              email,
              mobile,
              is_super_admin: isSuperAdmin,
              is_active: true,
            },
          });
          break;
        } catch (err) {
          if (isAdminIdConflict(err)) continue; // try another generated id
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // The genuine email/mobile race the pre-check above couldn't
            // close on its own — reported the same friendly way the
            // pre-check would have, not as a raw constraint violation.
            const target = err.meta?.target;
            const targetStr = Array.isArray(target)
              ? target.join(',')
              : String(target ?? '');
            const field = targetStr.includes('mobile')
              ? 'mobile number'
              : 'email';
            throw new ConflictException(
              `An admin account with this ${field} already exists.`,
            );
          }
          throw err;
        }
      }

      if (!created) {
        throw new ConflictException(
          'Could not generate a unique admin ID. Please try again.',
        );
      }

      await tx.admin_audit_log.create({
        data: {
          admin_id: actingAdminId,
          action: 'ADMIN_INVITED',
          target_type: 'SITE_ADMIN',
          target_id: created.admin_id,
          reason,
          metadata: { name, email, is_super_admin: isSuperAdmin },
        },
      });

      return {
        ...created,
        message: `Admin account ${created.admin_id} created for ${email}. They can sign in with the admin login OTP flow.`,
      };
    });
  }

  /**
   * ACTIVE -> deactivated (is_active = FALSE). No path back in this file —
   * chk_admin_audit_action has no ADMIN_REACTIVATED entry, matching the
   * plan's own "invite/deactivate" scope for this subphase; reactivating a
   * deactivated admin is not something 5.3 builds.
   *
   * Deliberately has no separate "you can't deactivate yourself" check.
   * This route is @RequireSuperAdmin()-gated end to end, so actingAdminId
   * is always an active super admin by the time requireActiveSuperAdmin()
   * above returns — which means the only way adminId === actingAdminId can
   * ever reach the last-active-super-admin count below with that count
   * equal to exactly 1 is if the caller genuinely is the sole remaining
   * active super admin deactivating themselves. A standalone self-check
   * would either duplicate that guard's job (when self-deactivating while
   * others remain active, both approaches allow it) or race ahead of it
   * with a less precise message (when self-deactivating alone, both
   * approaches block it) — so the one guard below covers both the
   * self-deactivation and distinct-actor cases without a redundant
   * unreachable special case bolted on top of it.
   */
  async deactivateAdmin(
    adminId: string,
    actingAdminId: string,
    dto: DeactivateAdminDto,
  ) {
    await this.requireActiveSuperAdmin(actingAdminId);
    const reason = this.requireReason(dto);

    const pre = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!pre) {
      throw new NotFoundException(`Admin account ${adminId} not found`);
    }
    if (!pre.is_active) {
      throw new ConflictException(
        `Admin account ${adminId} is already inactive.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          admin_id: string;
          name: string;
          email: string;
          is_active: boolean;
          is_super_admin: boolean;
        }>
      >`
        SELECT admin_id, name, email, is_active, is_super_admin
        FROM site_admins
        WHERE admin_id = ${adminId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Admin account ${adminId} not found`);
      }
      if (!claimed.is_active) {
        throw new ConflictException(
          `Admin account ${adminId} is already inactive.`,
        );
      }

      // Guard against locking every super admin out of admin-account
      // management entirely: if this is the last active super admin,
      // block the deactivation. There is no ADMIN_REACTIVATED action (see
      // this method's own header comment), so once the last active super
      // admin is gone, nothing in the application layer can invite or
      // reinstate one — only a direct database fix could recover from it.
      // This count necessarily includes actingAdminId itself (it was just
      // confirmed active+super by requireActiveSuperAdmin() above, and
      // nothing has written to site_admins yet in this transaction), so a
      // *distinct* actor deactivating a *distinct* target can only ever
      // observe a count of 2 or more here — the count reaching exactly 1
      // is only possible when adminId === actingAdminId, i.e. a super
      // admin deactivating themselves while no other active super admin
      // exists. That is the scenario this guard exists to block; every
      // other combination passes through untouched.
      if (claimed.is_super_admin) {
        const activeSuperAdmins = await tx.site_admins.count({
          where: { is_super_admin: true, is_active: true },
        });
        if (activeSuperAdmins <= 1) {
          throw new ConflictException(
            adminId === actingAdminId
              ? 'You are the last active super admin — deactivate or demote yourself only after another super admin exists.'
              : 'Cannot deactivate the last active super admin.',
          );
        }
      }

      const updated = await tx.site_admins.update({
        where: { admin_id: adminId },
        data: { is_active: false },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: actingAdminId,
          action: 'ADMIN_DEACTIVATED',
          target_type: 'SITE_ADMIN',
          target_id: adminId,
          reason,
          metadata: {
            name: claimed.name,
            email: claimed.email,
            was_super_admin: claimed.is_super_admin,
          },
        },
      });

      return updated;
    });

    return {
      ...result,
      message: `Admin account ${result.admin_id} (${result.email}) has been deactivated.`,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Same defense-in-depth check every write-path method since
   * OrgRequestsService.approve() (2.4) has carried — see this file's own
   * header comment — but also re-verifies is_super_admin, not just
   * is_active: every route this service is reached from is already behind
   * @RequireSuperAdmin(), but that decorator reads the JWT payload set at
   * login (subphase 1.3), not the current database row, so a
   * demoted-mid-session admin's still-valid token wouldn't otherwise be
   * caught until it expires.
   */
  private async requireActiveSuperAdmin(adminId: string) {
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!admin || !admin.is_active || !admin.is_super_admin) {
      throw new ForbiddenException(
        'This admin account is not an active super admin. Please sign in again.',
      );
    }
  }

  /**
   * deactivateAdmin()'s required-reason validation. `@IsNotEmpty()` on
   * DeactivateAdminDto only rejects the literal empty string, not a
   * whitespace-only one — same re-check precedent
   * OrgRequestsService.resolveReviewNotes() and
   * OrgLifecycleService.requireReason() both already establish for the
   * identical gap on their own DTOs.
   */
  private requireReason(dto: DeactivateAdminDto): string {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required to deactivate an admin account.',
      );
    }
    return reason;
  }
}
