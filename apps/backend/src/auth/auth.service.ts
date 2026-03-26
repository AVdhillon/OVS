import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { Request } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // 🔹 Generate OTP
  async sendOtp(identifier: string) {
    identifier = identifier.trim().toLowerCase();
    const recent = await this.prisma.otp_verification.findFirst({
      where: { identifier },
    });
    
    if (
      recent?.created_at &&
      recent.created_at > new Date(Date.now() - 30_000)
    ) {
      return { message: 'Please wait before requesting another OTP'};
    }
  
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  
    // 🔥 Delete ALL old OTPs (verified/unverified)
    await this.prisma.otp_verification.deleteMany({
      where: { identifier },
    });
  
    // ✅ Create fresh OTP
    await this.prisma.otp_verification.create({
      data: {
        identifier,
        otp_code: hashedOtp,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
  
    console.log('OTP:', otp);
    console.log('Now:', new Date());
    console.log('Expires:', new Date(Date.now() + 5 * 60 * 1000));
  
    return { message: 'OTP sent' };
  }

  // 🔹 Verify OTP
  async verifyOtp(identifier: string, otp: string) {
    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });
  
    if (!record) throw new UnauthorizedException('OTP not found');
  
    // ✅ CHECK EXPIRY HERE (NOT DB)
    if (record.expires_at < new Date()) {
      throw new UnauthorizedException('OTP expired');
    }
    if ((record.attempts ?? 0) >= 5) {
      throw new UnauthorizedException('Too many attempts');
    }
  
    const hashed = crypto.createHash('sha256').update(otp).digest('hex');
  
    if (record.otp_code !== hashed) {
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: (record.attempts ?? 0) + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }
  
    await this.prisma.otp_verification.update({
      where: { otp_id: record.otp_id },
      data: { is_verified: true },
    });
  
    return { verified: true };
  }

  // 🔹 LOGIN
  async login(data: any, req: Request) {
    let payload: any = {};
    
  
    // ------------------ IDENTIFY USER ------------------
  
    if (data.type === 'UNIFIED') {
      const user = await this.prisma.uaccount.findFirst({
        where: {
          OR: [
            { mobile: data.identifier },
            { email: data.identifier },
          ],
        },
      });
  
      if (!user) throw new UnauthorizedException('User not found');
  
      payload = { pid: user.pid, type: 'UNIFIED' };
    }
  
    if (data.type === 'ORG') {
      const member = await this.prisma.org_members.findFirst({
        where: {
          orgid: data.orgid,
          uid: data.uid,
        },
      });
  
      if (!member) throw new UnauthorizedException('Invalid org login');
  
      payload = {
        orgid: data.orgid,
        uid: data.uid,
        pid: member.pid,
        type: 'ORG',
      };
    }
  
    if (data.type === 'GOV') {
      const gov = await this.prisma.gov_identity.findUnique({
        where: { epic_id: data.epic_id },
      });
  
      if (!gov) throw new UnauthorizedException('Invalid GOV ID');
  
      payload = {
        epic_id: data.epic_id,
        type: 'GOV',
      };
    }
    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier: data.identifier },
      orderBy: { created_at: 'desc' },
    });
    
    if (!record || !record.is_verified) {
      throw new UnauthorizedException('OTP not verified');
    }
    // ------------------ 🔥 DEACTIVATE OLD SESSIONS ------------------
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
  
    // ------------------ CREATE TOKEN ------------------
  
    const verified_token = this.jwtService.sign(payload);
  
    // ------------------ SAVE SESSION ------------------
  
    await this.prisma.user_sessions.create({
      data: {
        pid: payload.pid || null,
        identity_type: payload.type,
        identity_id: payload.orgid || payload.epic_id || null,
        uid: payload.uid || null,
        ip_address: ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + 1 * 60 * 60 * 1000),
        token: verified_token,
      },
    });
    await this.prisma.otp_verification.delete({
      where: { otp_id: record.otp_id },
    });
    return { access_token: verified_token };
  }
  async logout(token: string) {
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    await this.prisma.user_sessions.updateMany({
      where: { token },
      data: { is_active: false },
    });
  
    return { message: 'Logged out successfully' };
  }
}