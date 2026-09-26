import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsIn,
  ValidateIf,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Finalize Org Request DTO ──────────────────────────────────────────────
// EDIT (Phase 6 — post-approval org finalization, subphase 6.3): input for
// OrgRequestsService.finalizeSetup() / POST /org/request/:requestId/finalize.
//
// This is the requester's half of the flow approve() (6.2) started: an
// admin has already signed off and set a member cap
// (org_requests.admin_set_member_limit), and status is
// 'APPROVED_PENDING_SETUP'. Nothing here is inferred from the original
// submission — org_name and admin_set_member_limit are read off the locked
// request row itself inside finalizeSetup(), not taken from this DTO — so
// every field below is something only the requester can supply at this
// exact moment: the orgid they want, a fresh confirmation of the org's
// contact email, and their own member uid.

/**
 * Mirrors the plan's `{ mode: 'preferred', orgid } | { mode: 'generate' }`
 * shape, maps directly onto orgid.utilities.ts's `OrgIdSpec.preferredOrgId`
 * (mode 'preferred') vs. leaving it unset for a fully generated ID (mode
 * 'generate'). A discriminated `mode` field rather than a bare optional
 * `orgid` (the way RegisterOrgDto's `preferred_orgid` works) so the
 * frontend's "type your own ID" vs. "generate one for me" choice is
 * explicit in the request body, not inferred from whether a string happens
 * to be present.
 */
export class OrgIdChoiceDto {
  @IsIn(['preferred', 'generate'])
  mode: 'preferred' | 'generate';

  /** Required if and only if mode is 'preferred' — nothing to validate for 'generate'. */
  @ValidateIf((o: OrgIdChoiceDto) => o.mode === 'preferred')
  @IsString()
  @IsNotEmpty({ message: 'orgid is required when mode is "preferred".' })
  @Matches(/^[A-Z]{3}[0-9]{4}$/, {
    message: 'orgid must be in format ABC1234',
  })
  orgid?: string;
}

export class FinalizeOrgRequestDto {
  @ValidateNested()
  @Type(() => OrgIdChoiceDto)
  orgid_choice: OrgIdChoiceDto;

  /**
   * Required even when org_requests.org_email was already supplied and
   * OTP-verified at submission (4.3) — real-world time may have passed
   * between submission and approval, so this is the requester's chance to
   * confirm or update it. finalizeSetup() compares this against the
   * request's stored org_email and only re-requires the domain-ownership
   * OTP flow (org_email_otp below) when it has actually changed — see that
   * method's own comment.
   */
  @IsEmail()
  @IsNotEmpty()
  org_email: string;

  /**
   * Code from POST /org/request/send-domain-otp (the same
   * 'ORG_DOMAIN_OWNERSHIP' purpose submit() itself uses), required only
   * when org_email above differs from what's already on the request row.
   * Not enforced here via @ValidateIf — that would need the request's
   * existing org_email, which isn't available at DTO-validation time — so
   * finalizeSetup() enforces this conditionally itself.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  org_email_otp?: string;

  /**
   * The requester's own chosen uid for their OWNER membership in the org
   * about to be created. Validated against the same format
   * org_members.chk_uid_format enforces — no uniqueness check needed here
   * (or in finalizeSetup()) against org_members, since the org this uid is
   * being inserted into does not exist yet, so there is structurally no
   * prior org_members row for it to collide with. See the "Owner uid"
   * header comment near the top of org-requests.service.ts for the fuller
   * history of why this is requester-chosen here rather than
   * server-generated the way it was before 6.2.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9]{4,20}$/, {
    message: 'owner_uid must be 4–20 uppercase alphanumeric characters',
  })
  owner_uid: string;
}
