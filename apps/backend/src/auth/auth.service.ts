import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../otp/otp.service';
import { LoginDto, SiteAdminLoginDto } from './dto/login.dto';
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

  // ─── Resolve OTP identifier for ORG logins ─────────────────────────────────
  // The client supplies orgid+uid. We look up the mobile/email that was
  // stored when that identity was enrolled, and send the OTP there — the
  // user never gets to specify an arbitrary identifier for this flow.
  //
  // EDIT (Phase 1 — auth model consolidation, subphase 1.2): the GOV branch
  // (epic_id -> gov_identity lookup) is removed — GOV login is retired
  // platform-wide (subphase 1.1 dropped gov_identity itself). See
  // resolveSiteAdminOtpIdentifier() below for the equivalent SITEADMIN flow.

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
      // EDIT (Phase 3 — admin portal core, subphase 3.4): gate ORG login on
      // organization.status. A member of a SUSPENDED/ARCHIVED org (Phase
      // 3.2's suspend()/archive()) must not be able to sign in as that org
      // — a live session is exactly what "suspended" is meant to prevent.
      // Checked here (before the OTP is ever sent) rather than only in
      // login()'s switch, since sendLoginOtp() also calls
      // resolveOtpIdentifier() and shouldn't hand out an OTP for a login
      // that login() would reject anyway. Queried as its own lookup rather
      // than a Prisma `include` on org_members — same reasoning as
      // OrgRequestsService/OrgDirectoryService (Phase 2/3.3): the real
      // relation field name isn't knowable without the outstanding
      // `prisma db pull` regen (flagged since subphase 1.1).
      const org = await this.prisma.organization.findUnique({
        where: { orgid: dto.orgid },
        select: { status: true },
      });
      if (!org || org.status !== 'ACTIVE') {
        throw new UnauthorizedException(
          'This organization is not currently active',
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

    throw new BadRequestException('Unknown login type');
  }

  // ─── Resolve OTP identifier for SITEADMIN logins ──────────────────────────
  // EDIT (Phase 1 — auth model consolidation, subphase 1.2): new, mirrors
  // the ORG branch above but against site_admins (added in subphase 1.1)
  // instead of org_members. Kept as its own method (SiteAdminLoginDto is a
  // separate class from LoginDto — see login.dto.ts) rather than folded
  // into resolveOtpIdentifier() above, so that method's exhaustiveness over
  // LoginDto's `type` union isn't disturbed by a third identity shape it
  // was never meant to know about.
  async resolveSiteAdminOtpIdentifier(
    dto: SiteAdminLoginDto,
  ): Promise<string> {
    if (!dto.admin_id) {
      throw new BadRequestException('admin_id is required for admin login');
    }
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: dto.admin_id },
      select: { mobile: true, email: true, is_active: true },
    });
    if (!admin || !admin.is_active) {
      throw new UnauthorizedException('Invalid or inactive admin account');
    }
    const contact = admin.email ?? admin.mobile;
    if (!contact) {
      throw new UnauthorizedException(
        'No contact on file for this admin account',
      );
    }
    return contact.trim().toLowerCase();
  }

  // ─── Send OTP for login (uses resolved identifier, not raw client input) ───
  async sendLoginOtp(dto: LoginDto) {
    const identifier = await this.resolveOtpIdentifier(dto);
    return this.otpService.sendOtp(identifier);
  }

  // ─── Send OTP for SITEADMIN login ──────────────────────────────────────────
  // EDIT (Phase 1 — auth model consolidation, subphase 1.2): new. Endpoint
  // wiring on the admin subdomain is subphase 1.3 — this method is what it
  // will call.
  async sendSiteAdminLoginOtp(dto: SiteAdminLoginDto) {
    const identifier = await this.resolveSiteAdminOtpIdentifier(dto);
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
    // FIX (finding #10): was sequential `if` blocks (each independently
    // testing dto.type), which TypeScript can't exhaustiveness-check and
    // which silently falls through to an empty payload `{}` if dto.type
    // is ever something unexpected. resolveOtpIdentifier() above already
    // throws on an unknown type, so today this is unreachable — but that
    // safety currently lives in a *different* method and could drift out
    // of sync with this one. An exhaustive switch with `default: throw`
    // makes login() safe on its own and gives a compile-time error
    // (TS2339 down where dto.type is used) if a new LoginDto type is ever
    // added without updating this switch.
    let payload: Record<string, any>;

    switch (dto.type) {
      case 'UNIFIED': {
        const identifier = otpIdentifier; // already normalised
        const user = await this.prisma.uaccount.findFirst({
          where: {
            OR: [{ mobile: identifier }, { email: identifier }],
          },
          select: { pid: true },
        });
        if (!user) throw new BadRequestException('User not found');
        payload = { pid: user.pid.toString(), type: 'UNIFIED' };
        break;
      }

      case 'ORG': {
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
        break;
      }

      default:
        throw new BadRequestException('Unknown login type');
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
    }

    // Step 5: Issue JWT & persist session.
    const token = this.jwtService.sign(payload);

    await this.prisma.user_sessions.create({
      data: {
        pid: payload.pid ? BigInt(payload.pid) : null,
        identity_type: payload.type,
        // identity_id stores orgid for ORG, null for UNIFIED
        identity_id: dto.orgid ?? null,
        uid: dto.uid ?? null,
        ip_address: ip,
        user_agent: req.headers['user-agent'] ?? null,
        expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        token,
      },
    });

    return { access_token: token };
  }

  // ─── SITEADMIN Login ────────────────────────────────────────────────────────
  // EDIT (Phase 1 — auth model consolidation, subphase 1.2): new. Mirrors
  // login()'s ORG branch, but issues a SITEADMIN session against
  // site_admins instead of org_members/uaccount:
  //   - payload carries `admin_id` (not `pid`/`orgid`/`uid`) plus
  //     `is_super_admin`, so @RequireSuperAdmin() (subphase 1.3) can read
  //     the elevated-tier flag straight off the JWT without a DB round trip
  //     on every guarded request.
  //   - Deliberately a SEPARATE method rather than a third case folded into
  //     login()'s switch — same rationale as resolveSiteAdminOtpIdentifier()
  //     above: this method's shape (SiteAdminLoginDto in, no `pid`/no
  //     unified-account session deactivation semantics) doesn't cleanly
  //     share a signature with the UNIFIED/ORG cases, and keeping it
  //     separate means a future change to login()'s switch can't
  //     accidentally regress admin auth or vice versa.
  //   - Cookie name/domain split (`ovp_admin_token`/`ovp_admin_csrf`, admin
  //     subdomain CORS) and the controller route itself are subphase 1.3 —
  //     this method only returns the signed token, same contract as
  //     login() above, for that controller to wrap in a cookie.
  async siteAdminLogin(dto: SiteAdminLoginDto, req: Request) {
    // Step 1: Resolve the canonical OTP identifier for admin login.
    const otpIdentifier = await this.resolveSiteAdminOtpIdentifier(dto);

    // Step 2: Verify OTP atomically before doing anything else.
    if (!dto.otp) {
      throw new BadRequestException('OTP missing');
    }
    await this.otpService.verifyOtp(otpIdentifier, dto.otp);

    // Step 3: Build JWT payload.
    // admin existence + is_active guaranteed by resolveSiteAdminOtpIdentifier,
    // but we still need is_super_admin, which that method doesn't select.
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: dto.admin_id },
      select: { admin_id: true, is_super_admin: true },
    });
    if (!admin) throw new BadRequestException('Admin not found');

    const payload = {
      type: 'SITEADMIN',
      admin_id: admin.admin_id,
      is_super_admin: admin.is_super_admin,
    };

    // Step 4: Deactivate previous active sessions for this admin.
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress;

    await this.prisma.user_sessions.updateMany({
      where: {
        identity_type: 'SITEADMIN',
        identity_id: admin.admin_id,
        is_active: true,
      },
      data: { is_active: false },
    });

    // Step 5: Issue JWT & persist session.
    const token = this.jwtService.sign(payload);

    await this.prisma.user_sessions.create({
      data: {
        pid: null, // site admins are not linked to uaccount — see site_admins table comment
        identity_type: payload.type,
        identity_id: admin.admin_id,
        uid: null,
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
