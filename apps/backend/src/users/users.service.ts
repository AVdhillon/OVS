import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ─── Register new unified account ────────────────────────────────────────
  async register(dto: RegisterDto) {
    if (!dto.mobile && !dto.email) {
      throw new BadRequestException(
        'At least one of mobile or email is required',
      );
    }

    const identifier = (dto.mobile ?? dto.email)!.trim().toLowerCase();

    // Verify OTP for the contact provided
    await this.verifyOtp(identifier, dto.otp);

    if (dto.mobile) {
      const dup = await this.prisma.uaccount.findFirst({ where: { mobile: dto.mobile } });
      if (dup) throw new BadRequestException('Mobile number already registered');
    }
    if (dto.email) {
      const dup = await this.prisma.uaccount.findFirst({ where: { email: dto.email } });
      if (dup) throw new BadRequestException('Email already registered');
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

    return user;
  }

  // ─── Get profile by pid ───────────────────────────────────────────────────
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

  // ─── Update profile ───────────────────────────────────────────────────────
  async updateProfile(pid: bigint, dto: UpdateUserDto) {
    if (dto.mobile) {
      const conflict = await this.prisma.uaccount.findFirst({
        where: { mobile: dto.mobile, NOT: { pid } },
      });
      if (conflict) throw new BadRequestException('Mobile number already in use');
    }

    if (dto.email) {
      const conflict = await this.prisma.uaccount.findFirst({
        where: { email: dto.email, NOT: { pid } },
      });
      if (conflict) throw new BadRequestException('Email already in use');
    }

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

  // ─── OTP helper ───────────────────────────────────────────────────────────
  private async verifyOtp(identifier: string, otp: string) {
    const record = await this.prisma.otp_verification.findFirst({
      where: { identifier, is_verified: false },
    });

    if (!record) throw new UnauthorizedException('OTP not found');
    if (record.expires_at < new Date()) throw new UnauthorizedException('OTP expired');
    if ((record.attempts ?? 0) >= 5) throw new UnauthorizedException('Too many failed attempts');

    const hashed = crypto.createHash('sha256').update(otp).digest('hex');

    if (record.otp_code !== hashed) {
      await this.prisma.otp_verification.update({
        where: { otp_id: record.otp_id },
        data: { attempts: (record.attempts ?? 0) + 1 },
      });
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.prisma.otp_verification.delete({ where: { otp_id: record.otp_id } });
  }
}
