// src/common/decorators/current-user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtUser {
  // FIX (finding #9): was typed `number`, but pid is always a string at
  // runtime. auth.service.ts encodes it into the JWT payload via
  // `user.pid.toString()` (BIGSERIAL pid -> string, to avoid precision
  // loss on values beyond Number.MAX_SAFE_INTEGER), and jwt.strategy.ts's
  // validate() spreads the decoded payload straight onto req.user with no
  // numeric coercion in between. Every call site already does
  // `BigInt(user.pid)`, which happens to accept a string fine — the old
  // `number` type was just misleading, not a runtime bug.
  pid?: string; // present for UNIFIED / ORG logins
  // EDIT (Phase 1 — auth model consolidation, subphase 1.2): GOV retired,
  // SITEADMIN added — matches the `identity_type` values now accepted by
  // user_sessions (chk_session_identity_type, subphase 1.1) and the
  // narrowed LoginDto/SiteAdminLoginDto union (subphase 1.2).
  type: 'UNIFIED' | 'ORG' | 'SITEADMIN';
  orgid?: string; // ORG login
  uid?: string; // ORG login
  admin_id?: string; // SITEADMIN login
  is_super_admin?: boolean; // SITEADMIN login — mirrors site_admins.is_super_admin; read by @RequireSuperAdmin() (subphase 1.3)
  session_id: string;
}

/**
 * @CurrentUser() user: JwtUser
 * Extracts the validated JWT payload attached by JwtStrategy.validate()
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtUser;
  },
);
