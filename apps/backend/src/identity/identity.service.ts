import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddIdentityDto } from './dto/add-identity.dto';
import * as crypto from 'crypto';

@Injectable()
export class IdentityService {
  constructor(private prisma: PrismaService) {}

  // ─── List all identities in a user's wallet ───────────────────────────────
  async getWallet(pid: bigint) {
    // Require unified account
    await this.requireUnifiedAccount(pid);

    const entries = await this.prisma.identity_wallet.findMany({
      where: { pid },
      select: {
        identity_type: true,
        identity_id: true,
        uid: true,
      },
    });

    return entries;
  }

  // ─── Add a new identity to the wallet ────────────────────────────────────
  async addIdentity(pid: bigint, dto: AddIdentityDto) {
    // 1. Caller must have a unified account (pid with mobile/email)
    await this.requireUnifiedAccount(pid);

    // 2. Verify OTP for the supplied identifier
    await this.verifyOtp(dto.identifier, dto.otp);

    // 3. Validate the identity exists and the identifier matches it
    if (dto.identity_type === 'GOV') {
      const gov = await this.prisma.gov_identity.findUnique({
        where: { epic_id: dto.identity_id },
      });
      if (!gov) throw new NotFoundException('Government identity not found');

      // Check the identifier belongs to this GOV record
      const contact = dto.identifier.includes('@') ? 'email' : 'mobile';
      if (gov[contact] !== dto.identifier) {
        throw new ForbiddenException(
          'Identifier does not match the GOV identity on record',
        );
      }
    }

    if (dto.identity_type === 'ORG') {
      if (!dto.uid) {
        throw new BadRequestException('uid is required for ORG identity');
      }

      const member = await this.prisma.org_members.findFirst({
        where: { orgid: dto.identity_id, uid: dto.uid },
      });
      if (!member) throw new NotFoundException('Org member not found');

      // Check the identifier belongs to this member
      const identifierIsEmail = dto.identifier.includes('@');
      const match = identifierIsEmail
        ? member.email === dto.identifier
        : member.mobile === dto.identifier;

      if (!match) {
        throw new ForbiddenException(
          'Identifier does not match the org member record',
        );
      }
    }

    // 4. Check not already linked
    const existing = await this.prisma.identity_wallet.findFirst({
      where: {
        pid,
        identity_type: dto.identity_type,
        identity_id: dto.identity_id,
        ...(dto.uid ? { uid: dto.uid } : {}),
      },
    });
    if (existing) throw new BadRequestException('Identity already in wallet');

    // 5. Insert
    const entry = await this.prisma.identity_wallet.create({
      data: {
        pid,
        identity_type: dto.identity_type,
        identity_id: dto.identity_id,
        uid: dto.uid ?? null,
      },
      select: {
        identity_type: true,
        identity_id: true,
        uid: true,
      },
    });

    // 6. If ORG — also bind pid to org_members row so the org can resolve
    //    the unified account from their roster
    if (dto.identity_type === 'ORG' && dto.uid) {
      await this.prisma.org_members.updateMany({
        where: { orgid: dto.identity_id, uid: dto.uid, pid: null },
        data: { pid },
      });

      // Ensure user_org link exists
      await this.prisma.user_org.upsert({
        where: {
          pid_orgid_uid: {
            pid,
            orgid: dto.identity_id,
            uid: dto.uid,
          },
        },
        update: {},
        create: {
          pid,
          orgid: dto.identity_id,
          uid: dto.uid,
        },
      });
    }

    return entry;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireUnifiedAccount(pid: bigint) {
    const user = await this.prisma.uaccount.findUnique({ where: { pid } });
    if (!user) {
      throw new ForbiddenException(
        'A unified account (mobile/email) is required to use the Identity Wallet',
      );
    }
    if (!user.mobile && !user.email) {
      throw new ForbiddenException(
        'Please add a mobile number or email to your account before using the Identity Wallet',
      );
    }
  }

  private async verifyOtp(identifier: string, otp: string) {
    identifier = identifier.trim().toLowerCase();

    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });

    if (!record) throw new UnauthorizedException('OTP not found or already used');

    if (record.expires_at < new Date()) {
      throw new UnauthorizedException('OTP expired');
    }

    if ((record.attempts ?? 0) >= 5) {
      throw new UnauthorizedException('Too many failed attempts');
    }

    const hashed = crypto.createHash('sha256').update(otp).digest('hex');

    if (record.otp_code !== hashed) {
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: (record.attempts ?? 0) + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Mark as verified then delete (consumed)
    await this.prisma.otp_verification.delete({
      where: { otp_id: record.otp_id },
    });
  }
}
