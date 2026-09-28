import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsInt,
  Length,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Submit Org Request DTO ───────────────────────────────────────────────────
// The input side of
// OrgRequestsService.submit().
//
// This is deliberately NOT a slimmed-down RegisterOrgDto. Registering an org
// and *asking* for one are different acts with different inputs:
//   - No preferred_orgid / org_prefix / org_suffix. The requester doesn't
//     pick the ID — no org exists yet, and the orgid is allocated by a site
//     admin's approval via runWithUniqueOrgId(), not by the requester.
//   - No caller_uid / caller_identifier. Those bind the caller as the first
//     member of an org that's being created right now; at submission time
//     there's nothing to be a member of. They belong to approve().
//   - No participants / participants_csv. Seeding a member list before
//     anyone has agreed the org should exist would mean carrying (and
//     having to re-validate) a potentially large roster through the whole
//     review cycle. Roster import stays part of post-approval setup.
// What's left is the case the requester is actually making.
export class SubmitOrgRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  org_name: string;

  /**
   * Contact address for the organization itself (not the requester — the
   * requester is identified by their session's pid).
   *
   * Optional here, but note it's the field the free-email-domain signal
   * and the domain-ownership OTP check both key off, so a request
   * submitted without one carries weaker verification evidence.
   */
  @IsOptional()
  @IsEmail()
  org_email?: string;

  /**
   * Code from the OTP sent to
   * org_email via POST /org/request/send-domain-otp, proving the requester
   * controls that address before submit() will create a row referencing it.
   *
   * Required if and only if org_email is present — with no org_email
   * there's nothing to prove control of. @ValidateIf mirrors the
   * conditional-field pattern update-user.dto.ts already uses for its own
   * optional-but-then-required companions (there: email/mobile guarding
   * their own OTP fields; here: org_email guarding this one).
   */
  @ValidateIf((o: SubmitOrgRequestDto) => !!o.org_email)
  @IsString()
  @IsNotEmpty({
    message: 'org_email_otp is required when org_email is supplied.',
  })
  org_email_otp?: string;

  /**
   * Rough size the requester expects the org to be. Used as a
   * verification signal (compared against the requester's account age), and
   * shown to the reviewing admin in the request detail page.
   *
   * Upper bound is a sanity cap on obvious junk, not a real limit.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  expected_member_count?: number;

  /**
   * Free-text case for why this org should exist — the main thing a human
   * reviewer reads. Length-capped so a single submission can't be used to
   * push an unbounded blob into the review queue.
   */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  justification?: string;
}
