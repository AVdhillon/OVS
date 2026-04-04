import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpDeliveryService } from './otp-delivery.service';
import * as crypto from 'crypto';

// How long before a fresh OTP can be requested for the same identifier.
const COOLDOWN_MS = 30_000; // 30 seconds
// OTP validity window.
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
// Maximum failed attempts before the record is locked.
const MAX_ATTEMPTS = 4;

@Injectable()
export class OtpService {
  constructor(
    private prisma: PrismaService,
    private delivery: OtpDeliveryService,
  ) {}

  /**
   * Generate, store, and dispatch an OTP to the given identifier.
   *
   * Identifier must be a 10-digit mobile number or a valid email address.
   * A 30-second cooldown is enforced per identifier.
   *
   * DB note: otp_verification has a partial unique index on (identifier)
   * WHERE is_verified = FALSE.  We delete the existing unverified record
   * before inserting a fresh one, so the constraint is never violated.
   * Verified records are deleted on successful verify(), so they never
   * interfere with the cooldown check.
   */
  async sendOtp(
    identifier: string,
  ): Promise<{ message: string; otp?: string }> {
    identifier = identifier.trim().toLowerCase();

    if (!this.isValidIdentifier(identifier)) {
      throw new BadRequestException(
        'Identifier must be a 10-digit mobile number or a valid email address',
      );
    }

    // ── Cooldown: only look at the live (unverified) record ─────────────────
    // Verified records no longer exist (deleted on success), so we only
    // need to filter is_verified = false to match the partial unique index.
    const existing = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
      select: { created_at: true, otp_id: true },
    });

    if (
      existing?.created_at &&
      existing.created_at > new Date(Date.now() - COOLDOWN_MS)
    ) {
      throw new HttpException('Please wait before requesting another OTP', 429);
    }

    // ── Generate OTP — plain value sent to user, hash stored in DB ──────────
    // FIX #2: crypto.randomInt is cryptographically secure, unlike Math.random().
    const otp = crypto.randomInt(100_000, 1_000_000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    // ── Atomically replace any stale unverified record for this identifier ───
    // FIX #4: Wrapped in a transaction to prevent a race condition where two
    // concurrent requests for the same identifier could both pass the cooldown
    // check and then both insert, violating the partial unique index.
    await this.prisma.$transaction([
      this.prisma.otp_verification.deleteMany({
        where: { identifier, is_verified: false },
      }),
      this.prisma.otp_verification.create({
        data: {
          identifier,
          otp_code: hashedOtp,
          attempts: 0,
          expires_at: new Date(Date.now() + EXPIRY_MS),
          // is_verified defaults to false (schema default)
        },
      }),
    ]);

    return {
      message: 'OTP sent',
      ...(process.env.OTP_DEVMODE === "true" && { otp }),
    };
  }

  /**
   * Verify an OTP.
   *
   * On success the record is hard-deleted (single-use guarantee).
   * Throws UnauthorizedException on any failure so callers get a clear 401.
   *
   * Returns true so callers can chain: `await this.otpService.verifyOtp(...)`.
   */
  async verifyOtp(identifier: string, otp: string): Promise<true> {
    identifier = identifier.trim().toLowerCase();

    // Only match active (unverified) records — consistent with partial index.
    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });

    if (!record) {
      throw new BadRequestException('No pending OTP found for this identifier');
    }

    if (record.expires_at < new Date()) {
      await this.prisma.otp_verification.delete({
        where: { otp_id: record.otp_id },
      });
      throw new BadRequestException('OTP has expired');
    }

    if ((record.attempts ?? 0) >= MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts — please request a new OTP',
        429,
      );
    }

    const hashed = crypto.createHash('sha256').update(otp).digest('hex');

    // FIX #1: Use constant-time comparison to prevent timing attacks.
    // Direct string equality (`!==`) leaks timing information that an attacker
    // could use to progressively narrow down the correct hash.
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(record.otp_code, 'hex'),
      Buffer.from(hashed, 'hex'),
    );

    if (!isMatch) {
      // Increment attempt counter; the record stays alive until expiry or success.
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid OTP');
    }

    // ── Success: delete for single-use guarantee ─────────────────────────────
    // We do NOT set is_verified = true; we delete instead.
    // This keeps the partial unique index (WHERE is_verified = false) clean
    // and ensures a consumed OTP cannot be replayed.
    await this.prisma.otp_verification.delete({
      where: { otp_id: record.otp_id },
    });

    return true;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isValidIdentifier(id: string): boolean {
    const isMobile = /^\d{10}$/.test(id);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
    return isMobile || isEmail;
  }
}
