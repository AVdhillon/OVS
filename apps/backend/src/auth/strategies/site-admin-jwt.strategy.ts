// src/auth/strategies/site-admin-jwt.strategy.ts
//
// EDIT (Phase 1 — auth model consolidation, subphase 1.3): new. The admin
// app's counterpart to jwt.strategy.ts. Registered under a distinct
// passport strategy name ('site-admin-jwt', not the default 'jwt') so the
// two coexist — a route guards with either AuthGuard('jwt') (regular
// UNIFIED/ORG sessions) or SiteAdminGuard (which wraps this strategy), and
// the two are never accidentally interchangeable at the passport level.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { getJwtSecret } from '../../common/utils/jwt-secret.util';
import * as express from 'express';

// Reads a DIFFERENT cookie than jwt.strategy.ts's cookieExtractor
// (`ovp_admin_token`, not `ovp_token`) — see auth.controller.ts, where
// login() and the new siteAdminLogin()-backed route set two disjoint
// cookie pairs. This lets an admin who is *also* a UNIFIED user hold both
// an ordinary session and an admin session in the same browser at once,
// without one login overwriting the other's cookie.
const adminCookieExtractor = (req: express.Request): string | null =>
  req?.cookies?.['ovp_admin_token'] ?? null;

@Injectable()
export class SiteAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'site-admin-jwt', // distinct strategy name — see SiteAdminGuard
) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: adminCookieExtractor,
      ignoreExpiration: false,
      // SECURITY: no hardcoded fallback secret — see jwt-secret.util.ts.
      secretOrKey: getJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: express.Request, payload: any) {
    const token = req.cookies?.['ovp_admin_token'] ?? null;

    if (!token) {
      throw new UnauthorizedException('Token missing');
    }

    // Same DB-backed session check as jwt.strategy.ts — the JWT alone
    // proves it was signed by us, not that the session hasn't since been
    // revoked (logout, or siteAdminLogin() deactivating this admin's
    // prior sessions on a fresh login elsewhere).
    const session = await this.prisma.user_sessions.findFirst({
      where: {
        token,
        is_active: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    if (session.expires_at < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    // Extra check with no equivalent in jwt.strategy.ts: a token issued
    // for an ordinary UNIFIED/ORG session and one issued for a SITEADMIN
    // session are both just JWTs signed with the same secret — nothing
    // about the token itself says which cookie it's "supposed" to live
    // in. Without this, a UNIFIED/ORG session token that ended up in the
    // ovp_admin_token cookie by some other means would otherwise pass
    // every check above. Pinning to the session's own identity_type
    // closes that off; only a session actually created by
    // AuthService.siteAdminLogin() can authenticate here.
    if (session.identity_type !== 'SITEADMIN') {
      throw new UnauthorizedException('Not an admin session');
    }

    return {
      ...payload,
      session_id: session.session_id,
    };
  }
}
