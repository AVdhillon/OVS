import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { getJwtSecret } from '../../common/utils/jwt-secret.util';
import * as express from 'express';

// JWT now travels as an httpOnly cookie, not an Authorization header — see
// The JWT is read from an httpOnly cookie, not a bearer header. Cookie name must match the one
// set/cleared in auth.controller.ts.
const cookieExtractor = (req: express.Request): string | null =>
  req?.cookies?.['ovp_token'] ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false, // ✅ JWT expiry check
      // SECURITY: no hardcoded fallback secret — see jwt-secret.util.ts.
      // Throws at module-init time in production if JWT_SECRET is unset.
      secretOrKey: getJwtSecret(),
      passReqToCallback: true, // ✅ to access req in validate
    });
  }

  async validate(req: express.Request, payload: any) {
    // 🔑 Extract token from the httpOnly cookie (not the Authorization header)
    const token = req.cookies?.['ovp_token'] ?? null;

    if (!token) {
      throw new UnauthorizedException('Token missing');
    }

    // 🔥 Check session in DB
    const session = await this.prisma.user_sessions.findFirst({
      where: {
        token,
        is_active: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // ⏳ Optional: check DB expiry
    if (session.expires_at < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    // 🧠 Attach useful data to request
    return {
      ...payload,
      session_id: session.session_id,
    };
  }
}