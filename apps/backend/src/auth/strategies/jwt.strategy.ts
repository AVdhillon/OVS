import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import * as express from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // ✅ JWT expiry check
      secretOrKey: process.env.JWT_SECRET || 'SECRET_KEY',
      passReqToCallback: true, // ✅ to access req in validate
    });
  }

  async validate(req: express.Request, payload: any) {
    // 🔑 Extract token from header
    console.log('here');
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

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