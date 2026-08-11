import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../otp/otp.service';
import { LoginDto } from './dto/login.dto';
import { Request } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private otpService: OtpService,
  ) {}

  // ─── Send OTP ─────────────────────────────────────────────────────────────
  // Delegates entirely to OtpService (which handles delivery + storage).
  async sendOtp(identifier: string) {
    return this.otpService.sendOtp(identifier);
  }

  // ─── Verify OTP (standalone endpoint, used in two-step flows) ─────────────
  // NOTE: consumes the OTP — the login endpoint does its own atomic check.
  // Only expose this to clients that do verify → then login as separate steps.
  async verifyOtp(identifier: string, otp: string) {
    await this.otpService.verifyOtp(identifier, otp);
    return { verified: true };
  }

  // ─── Resolve OTP identifier for ORG / GOV logins ──────────────────────────
  // The client supplies orgid+uid or epic_id. We look up the mobile/email that
  // was stored when that identity was enrolled, and send the OTP there —
  // the user never gets to specify an arbitrary identifier for these flows.

  async resolveOtpIdentifier(dto: LoginDto): Promise<string> {
    if (dto.type === 'UNIFIED') {
      if (!dto.identifier) {
        throw new BadRequestException(
          'identifier is required for UNIFIED login',
        );
      }
      return dto.identifier.trim().toLowerCase();
    }

    if (dto.type === 'ORG') {
      if (!dto.orgid || !dto.uid) {
        throw new BadRequestException(
          'orgid and uid are required for ORG login',
        );
      }
      const member = await this.prisma.org_members.findUnique({
        where: { orgid_uid: { orgid: dto.orgid, uid: dto.uid } },
        select: { mobile: true, email: true, is_deleted: true },
      });
      if (!member || member.is_deleted) {
        throw new UnauthorizedException('Invalid org member');
      }
      const contact = member.email ?? member.mobile;
      if (!contact) {
        throw new UnauthorizedException('No contact on file for this member');
      }
      return contact.trim().toLowerCase();
    }

    if (dto.type === 'GOV') {
      if (!dto.epic_id) {
        throw new BadRequestException('epic_id is required for GOV login');
      }
      const gov = await this.prisma.gov_identity.findUnique({
        where: { epic_id: dto.epic_id },
        select: { mobile: true, email: true, is_active: true },
      });
      if (!gov || !gov.is_active) {
        throw new UnauthorizedException('Invalid or inactive GOV identity');
      }
      const contact = gov.email ?? gov.mobile;
      if (!contact) {
        throw new UnauthorizedException('No contact on file for this EPIC ID');
      }
      return contact.trim().toLowerCase();
    }

    throw new BadRequestException('Unknown login type');
  }

  // ─── Send OTP for login (uses resolved identifier, not raw client input) ───
  async sendLoginOtp(dto: LoginDto) {
    const identifier = await this.resolveOtpIdentifier(dto);
    return this.otpService.sendOtp(identifier);
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, req: Request) {
    // Step 1: Resolve the canonical OTP identifier for this login type.
    // This prevents the client from directing OTPs to an arbitrary address.
    const otpIdentifier = await this.resolveOtpIdentifier(dto);

    // Step 2: Verify OTP atomically before doing anything else.
    if (!dto.otp) {
      throw new BadRequestException('OTP missing');
    }
    await this.otpService.verifyOtp(otpIdentifier, dto.otp);

    // Step 3: Build JWT payload per identity type.
    let payload: Record<string, any> = {};

    if (dto.type === 'UNIFIED') {
      const identifier = otpIdentifier; // already normalised
      const user = await this.prisma.uaccount.findFirst({
        where: {
          OR: [{ mobile: identifier }, { email: identifier }],
        },
        select: { pid: true },
      });
      if (!user) throw new BadRequestException('User not found');
      payload = { pid: user.pid.toString(), type: 'UNIFIED' };
    }

    if (dto.type === 'ORG') {
      // Member was already validated in resolveOtpIdentifier; fetch role info.
      const member = await this.prisma.org_members.findUnique({
        where: { orgid_uid: { orgid: dto.orgid!, uid: dto.uid! } },
        select: { pid: true },
      });
      // member existence guaranteed by resolveOtpIdentifier, but guard anyway
      if (!member) throw new BadRequestException('Member not found');
      payload = {
        type: 'ORG',
        orgid: dto.orgid,
        uid: dto.uid,
        pid: member.pid?.toString() ?? null,
      };
    }

    if (dto.type === 'GOV') {
      // gov_identity existence guaranteed by resolveOtpIdentifier
      payload = { type: 'GOV', epic_id: dto.epic_id };
    }

    // Step 4: Deactivate previous active sessions for this identity.
    // Build a targeted where-clause to avoid accidentally touching unrelated sessions.
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress;

    if (dto.type === 'UNIFIED' && payload.pid) {
      await this.prisma.user_sessions.updateMany({
        where: { pid: BigInt(payload.pid), is_active: true },
        data: { is_active: false },
      });
    } else if (dto.type === 'ORG') {
      await this.prisma.user_sessions.updateMany({
        where: {
          identity_type: 'ORG',
          identity_id: dto.orgid,
          uid: dto.uid,
          is_active: true,
        },
        data: { is_active: false },
      });
    } else if (dto.type === 'GOV') {
      await this.prisma.user_sessions.updateMany({
        where: {
          identity_type: 'GOV',
          identity_id: dto.epic_id,
          is_active: true,
        },
        data: { is_active: false },
      });
    }

    // Step 5: Issue JWT & persist session.
    const token = this.jwtService.sign(payload);

    await this.prisma.user_sessions.create({
      data: {
        pid: payload.pid ? BigInt(payload.pid) : null,
        identity_type: payload.type,
        // identity_id stores orgid for ORG, epic_id for GOV, null for UNIFIED
        identity_id: dto.orgid ?? dto.epic_id ?? null,
        uid: dto.uid ?? null,
        ip_address: ip,
        user_agent: req.headers['user-agent'] ?? null,
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
      where: { token, is_active: true },
      data: { is_active: false },
    });

    return { message: 'Logged out successfully' };
  }
}
