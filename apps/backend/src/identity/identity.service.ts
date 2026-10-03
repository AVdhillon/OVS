import {
  Injectable,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddIdentityDto } from './dto/add-identity.dto';
import { OtpService } from '../otp/otp.service';

// One generic message for every "this record doesn't exist / doesn't match /
// isn't linkable" outcome. Distinct messages here would let a caller probe
// which (orgid, uid) pairs exist, or which contacts belong to them.
const LINK_FAILED =
  'Could not link this identity. Check the Org ID, UID and contact, and try again.';

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
  //
  // Rules enforced here (and backstopped by the DB, see dbschema.sql):
  //   • one wallet entry per org per account   (PK: pid, type, orgid)
  //   • one account per org member             (uq_identity_wallet_member +
  //                                             atomic claim of org_members.pid)
  //   • only live members of ACTIVE orgs can be linked
  //
  // Ordering matters for information disclosure: the OTP proves the caller
  // controls the contact on the member record, so only AFTER that match do we
  // return specific conflict messages. Everything before it is one generic
  // error.
  async addIdentity(pid: bigint, dto: AddIdentityDto) {
    dto.identifier = dto.identifier.trim().toLowerCase();
    dto.uid = dto.uid.trim().toUpperCase();
    dto.identity_id = dto.identity_id.trim();

    // 1. Caller must have a unified account (pid with mobile/email)
    await this.requireUnifiedAccount(pid);

    // 2. Verify OTP for the supplied identifier
    await this.otpService.verifyOtp(dto.identifier, dto.otp);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 3. The member must exist, be live, and the OTP'd identifier must be
        //    the contact on that member record.
        const member = await tx.org_members.findFirst({
          where: { orgid: dto.identity_id, uid: dto.uid, is_deleted: false },
        });
        if (!member) throw new ForbiddenException(LINK_FAILED);

        const identifierIsEmail = dto.identifier.includes('@');
        const match = identifierIsEmail
          ? member.email?.trim().toLowerCase() === dto.identifier
          : member.mobile === dto.identifier;
        if (!match) throw new ForbiddenException(LINK_FAILED);

        // 4. Org must be ACTIVE (same rule ORG login enforces).
        const org = await tx.organization.findUnique({
          where: { orgid: dto.identity_id },
          select: { status: true },
        });
        if (!org || org.status !== 'ACTIVE') {
          throw new ForbiddenException(
            'This organization is not currently active',
          );
        }

        // 5. Member already belongs to a DIFFERENT unified account.
        if (member.pid !== null && member.pid !== pid) {
          throw new ConflictException(
            'This identity is already linked to another account',
          );
        }

        // 6. This account already has an identity in this org (PK is
        //    pid + type + orgid, so only one UID per org is possible).
        const existing = await tx.identity_wallet.findFirst({
          where: {
            pid,
            identity_type: dto.identity_type,
            identity_id: dto.identity_id,
          },
        });
        if (existing) {
          throw new ConflictException(
            existing.uid === dto.uid
              ? 'Identity already in wallet'
              : `Your account is already linked to UID ${existing.uid} in this organization`,
          );
        }

        // 7. Atomically claim the member. Succeeds only if it is still
        //    unclaimed (or already ours). Under READ COMMITTED a concurrent
        //    claimer blocks on the row lock, then re-evaluates this WHERE and
        //    matches 0 rows — so exactly one account wins.
        const claimed = await tx.org_members.updateMany({
          where: {
            orgid: dto.identity_id,
            uid: dto.uid,
            is_deleted: false,
            OR: [{ pid: null }, { pid }],
          },
          data: { pid },
        });
        if (claimed.count === 0) {
          throw new ConflictException(
            'This identity is already linked to another account',
          );
        }

        // 8. Insert into identity_wallet.
        return tx.identity_wallet.create({
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
      });
    } catch (err) {
      // Lost a race (double-submit, or two accounts at once) and hit a unique
      // index before our checks could. Report it as a clean 409 instead of
      // letting the raw Prisma error reach the UI.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This identity is already linked. Please refresh and check your wallet.',
        );
      }
      throw err;
    }
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
