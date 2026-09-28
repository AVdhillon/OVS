import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { SiteAdminGuard } from '../auth/guards/site-admin.guard';

// ─── Audit viewer routes ────────────────────────────────────────────────────
// Prefix 'admin/audit' — a sibling of 'admin/org-requests' and
// 'admin/organizations', behind the same plain @UseGuards(SiteAdminGuard):
// reading the audit record is ordinary site-admin work, not the elevated
// tier @RequireSuperAdmin() reserves. (Arguably an auditor is exactly who
// *should* be super-admin-only — but every action visible here was taken by
// an admin who already had rights to take it, and restricting oversight
// more tightly than the actions being overseen is backwards. Flagged as a
// deliberate decision in case a future admin-tier redesign wants to
// revisit it.)
//
// Every route is a GET. Nothing in this module writes, and admin_audit_log
// is append-only at the DB level anyway (trg_prevent_admin_audit_mutation).
@UseGuards(SiteAdminGuard)
@Controller('admin/audit')
export class AuditAdminController {
  constructor(private auditService: AuditService) {}

  /**
   * GET /admin/audit
   * The intent-level feed. All filters optional and additive:
   *   ?admin_id=SA0001
   *   ?action=ORG_SUSPENDED,ORG_ARCHIVED   (comma-separated)
   *   ?target_type=ORGANIZATION&target_id=ABC1234
   *   ?from=2026-01-01&to=2026-02-01       (ISO-8601)
   *   ?page=&page_size=                    (page_size capped at 100)
   * See AuditService.listAdminActions() for why there is no default filter.
   */
  @Get()
  list(
    @Query('admin_id') adminId?: string,
    @Query('action') action?: string,
    @Query('target_type') targetType?: string,
    @Query('target_id') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.auditService.listAdminActions({
      adminId,
      action: action
        ? action
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : undefined,
      targetType,
      targetId,
      from,
      to,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  /**
   * GET /admin/audit/organizations/:orgid
   * The per-org row-diff drill-down: every audited row change touching this
   * organization, newest first. `?table=` narrows to one of the tables
   * listed in the response's own `available_tables`. See
   * AuditService.listOrgChanges().
   *
   * Declared **above** the ':adminLogId' route below. Nest matches routes in
   * declaration order, so with the parameterised route first, 'organizations'
   * would be swallowed as an :adminLogId value and rejected by
   * parseAdminLogId() as non-numeric — a 400 on a route that exists.
   */
  @Get('organizations/:orgid')
  listOrgChanges(
    @Param('orgid') orgid: string,
    @Query('table') table?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.auditService.listOrgChanges(orgid, {
      table,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  /**
   * GET /admin/audit/:adminLogId
   * One admin action plus the row diffs written in the same transaction —
   * the drill-down half of the intent/diff pairing. See
   * AuditService.getAdminActionDetail().
   */
  @Get(':adminLogId')
  getDetail(@Param('adminLogId') adminLogId: string) {
    return this.auditService.getAdminActionDetail(
      this.parseAdminLogId(adminLogId),
    );
  }

  /**
   * admin_audit_log.admin_log_id is BIGSERIAL. Same guard
   * org-requests-admin.controller.ts uses for the same reason: a bare
   * BigInt() on a non-numeric URL segment throws a plain SyntaxError with
   * no HTTP status attached, surfacing as an unhandled 500 rather than a
   * clean 400.
   */
  private parseAdminLogId(raw: string): bigint {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('Invalid audit entry id');
    }
    return BigInt(raw);
  }
}
