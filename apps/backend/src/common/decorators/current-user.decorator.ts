// src/common/decorators/current-user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtUser {
  // Was typed `number`, but pid is always a string at
  // runtime. auth.service.ts encodes it into the JWT payload via
  // `user.pid.toString()` (BIGSERIAL pid -> string, to avoid precision
  // loss on values beyond Number.MAX_SAFE_INTEGER), and jwt.strategy.ts's
  // validate() spreads the decoded payload straight onto req.user with no
  // numeric coercion in between. Every call site already does
  // `BigInt(user.pid)`, which happens to accept a string fine — the old
  // `number` type was just misleading, not a runtime bug.
  pid?: string; // present for UNIFIED / ORG logins
  type: 'UNIFIED' | 'ORG' | 'SITEADMIN';
  orgid?: string; // ORG login
  uid?: string; // ORG login
  admin_id?: string; // SITEADMIN login
  is_super_admin?: boolean; // SITEADMIN login — mirrors site_admins.is_super_admin; read by @RequireSuperAdmin() 
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
