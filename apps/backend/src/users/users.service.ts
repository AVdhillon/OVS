import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import * as crypto from 'crypto';

// ─── Shape returned by thinness check ────────────────────────────────────────
interface ConflictAccount {
  pid: bigint;
  mobile: string | null;
  email: string | null;
  _count: {
    identity_wallet: number;
    user_org: number;
  };
}

// ─── Result of resolveContactConflict ────────────────────────────────────────
type ConflictResolution =
  | { action: 'none' }                          // no conflict
  | { action: 'merged'; into: bigint }          // thin account merged away
  | { action: 'blocked'; conflictPid: string }; // rich account — must use wallet

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) { }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Register new unified account ────────────────────────────────────────
  async register(dto: RegisterDto) {
    if (!dto.mobile && !dto.email) {
      throw new BadRequestException(
        'At least one of mobile or email is required',
      );
    }

    // OTP was sent to whichever contact was supplied
    const identifier = (dto.mobile ?? dto.email)!.trim().toLowerCase();
    await this.verifyOtp(identifier, dto.otp);

    // Hard-block duplicates at registration time — no merge here because we
    // don't have an authenticated pid to merge into yet.
    if (dto.mobile) {
      const dup = await this.prisma.uaccount.findFirst({
        where: { mobile: dto.mobile },
      });
      if (dup)
        throw new BadRequestException(
          'Mobile number already registered. Please log in instead.',
        );
    }
    if (dto.email) {
      const dup = await this.prisma.uaccount.findFirst({
        where: { email: dto.email },
      });
      if (dup)
        throw new BadRequestException(
          'Email already registered. Please log in instead.',
        );
    }

    const user = await this.prisma.uaccount.create({
      data: {
        first_name: dto.first_name,
        middle_name: dto.middle_name ?? null,
        last_name: dto.last_name,
        mobile: dto.mobile ?? null,
        email: dto.email ?? null,
        country: dto.country ?? null,
        state: dto.state ?? null,
      },
      select: {
        pid: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        mobile: true,
        email: true,
      },
    });

    return { ...user, pid: user.pid.toString() };
  }

  // ─── Get profile ─────────────────────────────────────────────────────────
  async getProfile(pid: bigint) {
    const user = await this.prisma.uaccount.findUnique({
      where: { pid },
      select: {
        pid: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        mobile: true,
        email: true,
        country: true,
        state: true,
        created_at: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return { ...user, pid: user.pid.toString() };
  }

  // ─── Update profile (with smart merge on contact conflicts) ──────────────
  /**
   * When the user adds a mobile or email that already exists on another account:
   *
   *  THIN account  → the other account has no mobile (for email conflict) or no
   *                  email (for mobile conflict), zero identity_wallet entries,
   *                  and zero user_org links. This almost certainly means the same
   *                  person registered twice. We auto-merge: all data from the thin
   *                  account is pulled into `pid` and the thin account is deleted.
   *
   *  RICH account  → the other account has its own contacts, wallet entries, or org
   *                  links. We cannot safely auto-merge. We return a structured
   *                  ConflictException so the frontend can guide the user to the
   *                  Identity Wallet flow to explicitly link them.
   *
   * The same symmetric logic applies to both mobile AND email conflicts.
   */
  async updateProfile(pid: bigint, dto: UpdateUserDto) {
    // ── 0. OTP gate — required whenever a contact field is being changed ───
    //    The OTP must have been sent to the NEW contact value so the user
    //    proves they own it before we assign it (and before any merge).
    // ── 0. OTP validation (separate for email & mobile) ──
    const currentUser = await this.prisma.uaccount.findUnique({
      where: { pid },
      select: {
        email: true,
        mobile: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }
    if (dto.email !== undefined && dto.email !== currentUser.email) {
      // Email OTP
      if (dto.email !== undefined) {
        if (!dto.email_otp) {
          throw new BadRequestException('Email OTP is required when changing email');
        }

        await this.verifyOtp(dto.email.trim().toLowerCase(), dto.email_otp);
      }

      // Mobile OTP
      if (dto.mobile !== undefined) {
        if (!dto.mobile_otp) {
          throw new BadRequestException('Mobile OTP is required when changing mobile');
        }

        await this.verifyOtp(dto.mobile.trim(), dto.mobile_otp);
      }
    }

    // ── 1. Resolve mobile conflict ─────────────────────────────────────────
    if (dto.mobile !== undefined) {
      const resolution = await this.resolveContactConflict(
        pid,
        'mobile',
        dto.mobile,
      );

      if (resolution.action === 'blocked') {
        throw new ConflictException({
          code: 'MOBILE_ACCOUNT_EXISTS',
          conflictPid: resolution.conflictPid,
          message:
            'This mobile number belongs to another account. ' +
            'Use the Identity Wallet to link them, or log in with that number.',
        });
      }
      // 'merged' or 'none' — proceed normally; merge already happened inside
    }

    // ── 2. Resolve email conflict ──────────────────────────────────────────
    if (dto.email !== undefined) {
      const resolution = await this.resolveContactConflict(
        pid,
        'email',
        dto.email,
      );

      if (resolution.action === 'blocked') {
        throw new ConflictException({
          code: 'EMAIL_ACCOUNT_EXISTS',
          conflictPid: resolution.conflictPid,
          message:
            'This email belongs to another account. ' +
            'Use the Identity Wallet to link them, or log in with that email.',
        });
      }
    }

    // ── 3. Apply the update (no conflict, or conflict was auto-merged) ─────
    const updated = await this.prisma.uaccount.update({
      where: { pid },
      data: {
        ...(dto.first_name !== undefined && { first_name: dto.first_name }),
        ...(dto.middle_name !== undefined && { middle_name: dto.middle_name }),
        ...(dto.last_name !== undefined && { last_name: dto.last_name }),
        ...(dto.mobile !== undefined && { mobile: dto.mobile }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.state !== undefined && { state: dto.state }),
      },
      select: {
        pid: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        mobile: true,
        email: true,
        country: true,
        state: true,
      },
    });

    return { ...updated, pid: updated.pid.toString() };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Checks whether the supplied contact value conflicts with another account.
   * If it does:
   *   - THIN  → calls mergeInto(conflictPid → pid) and returns { action: 'merged' }
   *   - RICH  → returns { action: 'blocked', conflictPid }
   * If no conflict → returns { action: 'none' }
   *
   * @param pid           The authenticated user's pid (merge TARGET — they keep their pid)
   * @param field         'mobile' | 'email'
   * @param value         The contact value being added
   */
  private async resolveContactConflict(
    pid: bigint,
    field: 'mobile' | 'email',
    value: string,
  ): Promise<ConflictResolution> {
    if (!value) return { action: 'none' };

    // Find a conflicting account (different pid, same contact value)
    const conflict = (await this.prisma.uaccount.findFirst({
      where: { [field]: value, NOT: { pid } },
      select: {
        pid: true,
        mobile: true,
        email: true,
        _count: {
          select: {
            identity_wallet: true,
            user_org: true,
          },
        },
      },
    })) as ConflictAccount | null;

    if (!conflict) return { action: 'none' };

    // ── Thinness check ────────────────────────────────────────────────────
    //
    // A "thin" account is one that was created with only a single contact
    // (the one we're conflicting on) and has never accumulated any links.
    //
    // Criteria for THIN:
    //   • The OTHER contact field is null (no second identifier)
    //   • Zero identity_wallet entries (no GOV/ORG identities bound)
    //   • Zero user_org entries (no org memberships linked via pid)
    //
    // If any of these is non-zero the account is "rich" and we block.
    const otherField = field === 'mobile' ? 'email' : 'mobile';
    const isThin =
      conflict[otherField] === null &&
      conflict._count.identity_wallet === 0 &&
      conflict._count.user_org === 0;

    if (!isThin) {
      return {
        action: 'blocked',
        conflictPid: conflict.pid.toString(),
      };
    }

    // ── Auto-merge ────────────────────────────────────────────────────────
    this.logger.log(
      `Auto-merging thin account pid=${conflict.pid} into pid=${pid} ` +
      `(${field} conflict: ${value})`,
    );
    await this.mergeAccounts(conflict.pid, pid);

    return { action: 'merged', into: pid };
  }

  /**
   * Migrates all data owned by `sourcePid` into `targetPid`, then deletes
   * the source account. Runs inside a transaction for atomicity.
   *
   * Tables affected (all that reference pid):
   *   org_members   — pid column (SET NULL on delete, so we set it explicitly)
   *   user_org      — pid PK component (delete + re-insert to retarget)
   *   identity_wallet — pid PK component (delete + re-insert to retarget)
   *   user_sessions — pid column (just deactivate; stale tokens are useless)
   *
   * uaccount itself is deleted last (all FKs must be cleared first).
   */
  private async mergeAccounts(sourcePid: bigint, targetPid: bigint) {
    await this.prisma.$transaction(async (tx) => {
      // ── 1. Deactivate all sessions for the source account ────────────────
      await tx.user_sessions.updateMany({
        where: { pid: sourcePid },
        data: { is_active: false },
      });

      // ── 2. Re-point org_members rows that have pid = sourcePid ──────────
      //    org_members has ON DELETE SET NULL so we must do this before
      //    deleting the source uaccount.
      await tx.org_members.updateMany({
        where: { pid: sourcePid },
        data: { pid: targetPid },
      });

      // ── 3. Migrate user_org rows ─────────────────────────────────────────
      //    pid is part of the PK so we can't simply update it.
      //    Read → delete → upsert with new pid.
      const orgLinks = await tx.user_org.findMany({
        where: { pid: sourcePid },
      });

      if (orgLinks.length > 0) {
        await tx.user_org.deleteMany({ where: { pid: sourcePid } });

        for (const link of orgLinks) {
          await tx.user_org.upsert({
            where: {
              pid_orgid_uid: {
                pid: targetPid,
                orgid: link.orgid,
                uid: link.uid,
              },
            },
            update: {},
            create: {
              pid: targetPid,
              orgid: link.orgid,
              uid: link.uid,
            },
          });
        }
      }

      // ── 4. Migrate identity_wallet rows ──────────────────────────────────
      //    pid is part of the composite PK; same read → delete → upsert pattern.
      const walletEntries = await tx.identity_wallet.findMany({
        where: { pid: sourcePid },
      });

      if (walletEntries.length > 0) {
        await tx.identity_wallet.deleteMany({ where: { pid: sourcePid } });

        for (const entry of walletEntries) {
          // Skip if targetPid already has this exact identity
          await tx.identity_wallet.upsert({
            where: {
              pid_identity_type_identity_id: {
                pid: targetPid,
                identity_type: entry.identity_type,
                identity_id: entry.identity_id,
              },
            },
            update: {},
            create: {
              pid: targetPid,
              identity_type: entry.identity_type,
              identity_id: entry.identity_id,
              uid: entry.uid,
            },
          });
        }
      }

      // ── 5. Delete the now-empty source uaccount ──────────────────────────
      //    All FK children have been moved or nulled above.
      await tx.uaccount.delete({ where: { pid: sourcePid } });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async verifyOtp(identifier: string, otp: string) {
    identifier = identifier.trim().toLowerCase();

    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });

    if (!record) throw new UnauthorizedException('OTP not found');
    if (record.expires_at < new Date())
      throw new UnauthorizedException('OTP expired');
    if ((record.attempts ?? 0) >= 5)
      throw new UnauthorizedException('Too many failed attempts');

    const hashed = crypto.createHash('sha256').update(otp).digest('hex');

    if (record.otp_code !== hashed) {
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: (record.attempts ?? 0) + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.prisma.otp_verification.delete({
      where: { otp_id: record.otp_id },
    });
  }
}