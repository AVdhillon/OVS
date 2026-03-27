import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../otp/otp.service';
import { Request } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private otpService: OtpService,   // ← injected from OtpModule
  ) {}

  // ─── Send OTP ─────────────────────────────────────────────────────────────
  // Delegates entirely to OtpService (which handles delivery + storage).
  async sendOtp(identifier: string) {
    return this.otpService.sendOtp(identifier);
  }

  // ─── Verify OTP (standalone endpoint, used before login) ─────────────────
  async verifyOtp(identifier: string, otp: string) {
    // NOTE: this marks OTP as consumed.
    // The login endpoint does its own OTP check below — this endpoint is
    // kept for clients that do a two-step flow (verify → then login).
    await this.otpService.verifyOtp(identifier, otp);
    return { verified: true };
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  async login(data: any, req: Request) {
    let payload: any = {};

    // ── Resolve identity ─────────────────────────────────────────────────
    if (data.type === 'UNIFIED') {
      const user = await this.prisma.uaccount.findFirst({
        where: {
          OR: [{ mobile: data.identifier }, { email: data.identifier }],
        },
      });
      if (!user) throw new UnauthorizedException('User not found');
      payload = { pid: user.pid.toString(), type: 'UNIFIED' };
    }

    if (data.type === 'ORG') {
      const member = await this.prisma.org_members.findFirst({
        where: { orgid: data.orgid, uid: data.uid },
      });
      if (!member) throw new UnauthorizedException('Invalid org login');
      payload = { orgid: data.orgid, uid: data.uid, pid: member.pid?.toString(), type: 'ORG' };
    }

    if (data.type === 'GOV') {
      const gov = await this.prisma.gov_identity.findUnique({
        where: { epic_id: data.epic_id },
      });
      if (!gov) throw new UnauthorizedException('Invalid GOV ID');
      payload = { epic_id: data.epic_id, type: 'GOV' };
    }

    // ── Verify OTP was consumed (login flow: sendOtp → login with otp field)
    // Re-verify here so login is atomic — no separate /verify-otp step needed.
    await this.otpService.verifyOtp(data.identifier, data.otp);

    // ── Deactivate old sessions ──────────────────────────────────────────
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress;

    await this.prisma.user_sessions.updateMany({
      where: {
        OR: [
          { pid: payload.pid ?? undefined },
          {
            identity_type: payload.type,
            identity_id: payload.orgid || payload.epic_id || null,
          },
        ],
        is_active: true,
      },
      data: { is_active: false },
    });

    // ── Issue JWT & persist session ──────────────────────────────────────
    const token = this.jwtService.sign(payload);

    await this.prisma.user_sessions.create({
      data: {
        pid: payload.pid ? BigInt(payload.pid) : null,
        identity_type: payload.type,
        identity_id: payload.orgid || payload.epic_id || null,
        uid: payload.uid || null,
        ip_address: ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        token,
      },
    });

    return { access_token: token };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  async logout(token: string) {
    if (!token) throw new UnauthorizedException('No token provided');

    await this.prisma.user_sessions.updateMany({
      where: { token },
      data: { is_active: false },
    });

    return { message: 'Logged out successfully' };
  }
}
