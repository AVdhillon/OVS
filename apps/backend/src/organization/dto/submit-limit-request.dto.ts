import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

// ─── Submit Member Limit Request DTO ───────────────────────────────────────
// The input
// side of OrgLimitRequestsService.submit(). `orgid` and `requested_by_uid`
// are NOT fields here — same reasoning SubmitOrgRequestDto's own header
// comment gives for leaving caller identity out of its body: `orgid` comes
// from the route param (POST /org/:orgid/member-limit-requests) and the
// requester's uid comes from RolesGuard's resolved `req.orgContext.uid`
// (populated by @RequireOrganizer('orgid') — see org.controller.ts's other
// organizer-gated routes for the same pattern), never trusted from the body.
//
// No `current_limit` field either — submit() snapshots that itself from
// organization.member_limit at call time (see its own header comment); asking
// the caller to supply it would just be a value they could get wrong or
// spoof, for something the server already knows.
export class SubmitLimitRequestDto {
  /**
   * The new cap being asked for. Must be greater than the org's current
   * member_limit — submit() checks this itself (and
   * chk_limit_request_increase backstops it at the DB level), so nothing
   * beyond "a positive integer" is validated here.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requested_limit: number;

  /**
   * Free-text case for why the org needs more room — shown to the reviewing
   * admin, same role org_requests.justification plays for a new-org request.
   */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  justification?: string;
}
