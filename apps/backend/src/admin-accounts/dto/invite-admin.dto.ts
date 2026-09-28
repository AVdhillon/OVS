import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';

// ─── Invite Admin DTO ──────────────────────────────────────────────────────
// Input for
// AdminAccountsService.inviteAdmin() / POST /admin/admins.
//
// There is no password field anywhere in this DTO, and deliberately so:
// site_admins has never had one — admin login is
// OTP-to-email/mobile, exactly like every other identity in this codebase
// (see auth.service.ts's resolveSiteAdminOtpIdentifier()). Inviting an
// admin is therefore just creating the site_admins row; the invited person
// signs in immediately afterward through the existing
// POST /auth/send-admin-login-otp / POST /auth/admin-login flow, using the
// admin_id this call returns plus a code sent to the email given here. No
// separate "accept invite" step or token exists because none is needed.
//
// `reason` is optional here even though this is an admin-audit-log-writing
// action, mirroring OrgLifecycleReasonDto's own optional-at-the-DTO-level
// pattern for actions chk_admin_audit_reason_required does NOT require a
// reason for — ADMIN_INVITED is absent from that CHECK's list, same as
// ORG_REINSTATED. An inviter can note why they're adding someone, but the
// database doesn't force it the way it forces one for ADMIN_DEACTIVATED
// (see DeactivateAdminDto).
export class InviteAdminDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name: string;

  // site_admins.email is UNIQUE NOT NULL — the contact an admin-login OTP
  // is always sent to first (mobile is a secondary fallback, same as every
  // other identity's OTP resolution in this codebase).
  @IsEmail()
  email: string;

  // site_admins.mobile is optional (nullable, UNIQUE). Same 10-digit format
  // used everywhere else a mobile number is collected in this codebase
  // (register.dto.ts / update-user.dto.ts).
  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'mobile must be a 10-digit number' })
  mobile?: string;

  // Defaults to false in the service if omitted — an invited admin starts
  // as an ordinary (non-super) admin unless explicitly elevated. Only a
  // super admin can set this at all, since inviteAdmin() itself is
  // @RequireSuperAdmin()-gated end to end.
  @IsOptional()
  @IsBoolean()
  is_super_admin?: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  reason?: string;
}
