// src/auth/guards/site-admin.guard.ts
//
// The admin app's counterpart to jwt.guard.ts's JwtAuthGuard, plus the
// @RequireSuperAdmin() check folded in.
//
// Usage:
//   @UseGuards(SiteAdminGuard)                       // any active admin
//   @UseGuards(SiteAdminGuard) @RequireSuperAdmin()   // super admins only
//
// A single guard class (rather than SiteAdminGuard + a separate
// SuperAdminGuard chained after it) so route authors can't forget to
// stack the second guard — @RequireSuperAdmin() alone, without
// SiteAdminGuard, does nothing (no guard reads the metadata), so the
// pairing above is the only way super-admin-only routes get enforced.

import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { SUPER_ADMIN_KEY } from '../../common/decorators/require-super-admin.decorator';

@Injectable()
export class SiteAdminGuard extends AuthGuard('site-admin-jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Runs SiteAdminJwtStrategy first — validates the ovp_admin_token
    // cookie + SITEADMIN session, same as AuthGuard('jwt') does for
    // ordinary users. AuthGuard's default canActivate() throws its own
    // UnauthorizedException on failure, so a `false` return here is only
    // ever reached if a custom strategy result handler were added later.
    const isAuthenticated = (await super.canActivate(context)) as boolean;
    if (!isAuthenticated) return false;

    const requiresSuperAdmin = this.reflector.getAllAndOverride<boolean>(
      SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresSuperAdmin) return true;

    const req = context.switchToHttp().getRequest();
    if (!req.user?.is_super_admin) {
      throw new ForbiddenException('Super admin role required');
    }

    return true;
  }
}
