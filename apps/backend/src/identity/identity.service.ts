import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddIdentityDto } from './dto/add-identity.dto';
import { OtpService } from '../otp/otp.service';

@Injectable()
export class IdentityService {
  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
  ) {}

  // ─── List all identities in a user's wallet ───────────────────────────────
  async getWallet(pid: bigint) {
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
    dto.identifier = dto.identifier.trim().toLowerCase();
    // 1. Caller must have a unified account (pid with mobile/email)
    await this.requireUnifiedAccount(pid);
    // 2. Verify OTP for the supplied identifier
    await this.otpService.verifyOtp(dto.identifier, dto.otp);
    return await this.prisma.$transaction(async (tx) => {
      // 3. Validate the identity exists and the identifier matches it.
      const member = await tx.org_members.findFirst({
        where: { orgid: dto.identity_id, uid: dto.uid },
      });
      if (!member) throw new NotFoundException('Org member not found');

      const identifierIsEmail = dto.identifier.includes('@');
      const match = identifierIsEmail
        ? member.email === dto.identifier
        : member.mobile === dto.identifier;

      if (!match) {
        throw new ForbiddenException(
          'Identifier does not match the org member record',
        );
      }

      // 4. Check not already linked
      const existing = await tx.identity_wallet.findFirst({
        where: {
          pid,
          identity_type: dto.identity_type,
          identity_id: dto.identity_id,
          uid: dto.uid,
        },
      });
      if (existing) throw new BadRequestException('Identity already in wallet');

      // 5. Insert into identity_wallet
      const entry = await tx.identity_wallet.create({
        data: {
          pid,
          identity_type: dto.identity_type,
          identity_id: dto.identity_id,
          uid: dto.uid,
        },
        select: {
          identity_type: true,
          identity_id: true,
          uid: true,
        },
      });

      // 6. Also bind pid to org_members so the org can resolve the unified
      //    account from their roster.
      //    org_members.pid is the authoritative link; no separate join table exists.
      await tx.org_members.updateMany({
        where: { orgid: dto.identity_id, uid: dto.uid, pid: null },
        data: { pid },
      });
      return entry;
    });
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
}
