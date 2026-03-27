import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpDeliveryService } from './otp-delivery.service';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  constructor(
    private prisma: PrismaService,
    private delivery: OtpDeliveryService,
  ) {}

  /**
   * Generate, store, and dispatch an OTP to the given identifier.
   * Identifier can be a 10-digit mobile or an email address.
   * Enforces a 30-second cooldown between requests.
   */
  async sendOtp(identifier: string): Promise<{ message: string }> {
    identifier = identifier.trim().toLowerCase();

    // ── Cooldown check ──────────────────────────────────────────────────
    const recent = await this.prisma.otp_verification.findFirst({
      where: { identifier },
    });

    if (recent?.created_at && recent.created_at > new Date(Date.now() - 30_000)) {
      return { message: 'Please wait before requesting another OTP' };
    }

    // ── Generate OTP ────────────────────────────────────────────────────
    const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    // ── Clean up stale records, create fresh one ────────────────────────
    await this.prisma.otp_verification.deleteMany({ where: { identifier } });

    await this.prisma.otp_verification.create({
      data: {
        identifier,
        otp_code: hashedOtp,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // ── Deliver ─────────────────────────────────────────────────────────
    await this.delivery.send(identifier, otp);
    console.log(otp);

    return { message: 'OTP sent' };
  }

  /**
   * Verify an OTP. On success the record is deleted (single-use).
   * Returns true so callers can chain without re-querying.
   */
  async verifyOtp(identifier: string, otp: string): Promise<true> {
    identifier = identifier.trim().toLowerCase();

    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });

    if (!record) throw new UnauthorizedException('OTP not found');
    if (record.expires_at < new Date()) throw new UnauthorizedException('OTP expired');
    if ((record.attempts ?? 0) >= 5) throw new UnauthorizedException('Too many attempts');

    const hashed = crypto.createHash('sha256').update(otp).digest('hex');

    if (record.otp_code !== hashed) {
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: (record.attempts ?? 0) + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    // Single-use: delete on success
    await this.prisma.otp_verification.delete({ where: { otp_id: record.otp_id } });

    return true;
  }
}
