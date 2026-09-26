import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitOrgRequestDto } from './dto/submit-org-request.dto';
import { SendOrgDomainOtpDto } from './dto/send-org-domain-otp.dto';
import {
  ReviewOrgRequestDto,
  ApproveOrgRequestDto,
} from './dto/review-org-request.dto';
// EDIT (Phase 6 — subphase 6.3): finalizeSetup() below is the new caller —
// approve() (6.2) stopped calling either of these; see that method's own
// header comment for why the org-creation responsibility moved here.
import { runWithUniqueOrgId } from './orgid.utilities';
import { createOrganizationCore } from './org-creation.utilities';
import { FinalizeOrgRequestDto } from './dto/finalize-org-request.dto';
import { OtpService } from '../otp/otp.service';
// EDIT (Phase 4 — cutover, subphase 4.5): the four org-request lifecycle
// notifications — see org-request-email.service.ts's own header comment
// for why this is a separate service rather than folded in here.
import { OrgRequestEmailService } from './org-request-email.service';

// ─── Org request staging (Phase 2) ────────────────────────────────────────────
// EDIT (Phase 2 — org request staging, subphase 2.3): new service.
//
// Today OrgService.registerOrg() creates an organization the instant someone
// asks for one. This service is the staging layer that replaces that flow:
// a request is submitted here, a site admin reviews it, and only on approval
// (2.4) does an `organization` row come into existence.
//
// EDIT (subphase 2.4): approve() added.
//
// EDIT (subphase 2.5): reject() and requestInfo() added — this closes out
// every decision a site admin can make on an open request (approve / reject
// / ask for more information).
//
// EDIT (Phase 3 — admin portal core, subphase 3.1): list() and getDetail()
// added — the read side Phase 2 didn't need (it was write-path-only) but
// 3.1's admin controller does, for the review queue and request-detail
// routes. The routes that call any of submit/approve/reject/requestInfo/
// list/getDetail are 3.1 (admin side, this subphase) and 4.1 (requester
// side, submit() only).
//
// EDIT (Phase 4 — cutover, subphase 4.1): POST /org/register was replaced by
// POST /org/request (org.controller.ts), so submit() is now reachable — the
// note above about it being test-only until 4.1 landed no longer applies.

/** Statuses in which a request is still awaiting a decision. */
export const OPEN_ORG_REQUEST_STATUSES = ['PENDING', 'NEEDS_INFO'] as const;

/**
 * Mirrors org_requests.chk_org_request_status in the master schema.
 *
 * EDIT (Phase 6 — post-approval org finalization, subphase 6.1/6.2): added
 * 'APPROVED_PENDING_SETUP' — reachable from approve() (6.2) once it stops
 * creating the organization itself; 'APPROVED' is now only reachable via
 * finalizeSetup() (6.3).
 */
export type OrgRequestStatus =
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED_PENDING_SETUP'
  | 'APPROVED'
  | 'REJECTED';

/**
 * Every status org_requests.status can hold — OPEN_ORG_REQUEST_STATUSES plus
 * the three terminal-or-pending-setup ones. Used by list() (subphase 3.1) to
 * validate a caller-supplied ?status= filter against the full set, not just
 * the open ones — an admin browsing history needs to filter to
 * APPROVED_PENDING_SETUP/APPROVED/REJECTED too.
 */
export const ALL_ORG_REQUEST_STATUSES = [
  'PENDING',
  'NEEDS_INFO',
  'APPROVED_PENDING_SETUP',
  'APPROVED',
  'REJECTED',
] as const;

// EDIT (Phase 4 — cutover, subphase 4.2): submit() now computes and stores
// three verification signals (fuzzy name match, free-email-domain flag,
// expected_member_count vs. account age) — see submit()'s own comments for
// each, and dbschema.sql's org_requests columns for where they land. All
// three are informational only: nothing here blocks or auto-rejects a
// submission, they just give the reviewing admin more to go on than the
// requester's own justification text.
//
// EDIT (Phase 4 — cutover, subphase 4.4): submit() now also enforces a
// per-pid cooldown (SUBMIT_COOLDOWN_MS, below) before the row is created —
// see that constant's own comment for how this differs from
// unique_open_org_request's per-name guard. org.controller.ts's
// POST /org/request route also picked up its first-ever per-IP
// @Throttle() in this subphase (it had none before), and
// auth.controller.ts's ADMIN_LOGIN_THROTTLE was tightened — see that
// file's own comment for the new value and why.
//
// EDIT (Phase 4 — cutover, subphase 4.5): submit()/approve()/reject()/
// requestInfo() each now send the requester a transactional email once
// their own action has already succeeded (row created / transaction
// committed) — see org-request-email.service.ts's own header comment for
// why that's a separate service, and each call site below for exactly
// when in the method it fires and why.

// ─── Owner uid (subphase 2.4, removed in 6.3) ─────────────────────────────────
// This file used to generate a random OWNERxxxx uid on the requester's
// behalf (generateInitialOwnerUid()) when approve() itself created the
// organization. As of 6.2, approve() no longer creates any org_members row
// at all, and as of 6.3, finalizeSetup() — the method that now does —
// takes a requester-chosen `owner_uid` (FinalizeOrgRequestDto) instead of
// a random one: the requester is present, authenticated, and finishing
// setup themselves, so there's no reason to assign them an ID they didn't
// pick, the way there was when an admin's click was what created the org.
// No collision-retry loop is needed for it, unlike orgid generation: uid is
// only unique *within an org* (org_members' PK is (orgid, uid)), and the
// org a chosen uid is being inserted into does not exist until the same
// transaction creates it — see FinalizeOrgRequestDto.owner_uid's own
// comment. generateInitialOwnerUid() itself is deleted rather than left
// unreferenced, per its own former comment flagging exactly this removal
// once 6.3 landed.

// ─── Verification signal constants (subphase 4.2) ─────────────────────────────
// All three thresholds below are heuristics for what's worth showing a
// reviewer, not fraud verdicts — see each signal's use in submit() for how
// they're applied and why a value below them isn't stored as "0" or
// "false-but-notable", just left as the column's neutral default/NULL.

/**
 * pg_trgm's similarity() returns a score in [0, 1] for *any* two strings,
 * including totally unrelated ones — most pairs score somewhere above zero
 * by chance. Below this floor, the closest existing org name isn't a
 * meaningful duplicate-name signal, just noise; storing it would make every
 * request look like it has "a match" when it doesn't. 0.3 is pg_trgm's own
 * conventional default similarity threshold (the value
 * `SET pg_trgm.similarity_threshold` defaults to), reused here rather than
 * invented fresh.
 */
const NAME_SIMILARITY_THRESHOLD = 0.3;

/**
 * Common consumer email providers. An org_email on one of these domains
 * doesn't mean anything is wrong — plenty of legitimate small/informal orgs
 * register with a personal address — but it's weaker evidence of org
 * ownership than a custom domain would be, which is what 4.3's domain-
 * ownership OTP check (verifying control of org_email's domain) will
 * eventually lean on. Deliberately not exhaustive: this is a coarse signal,
 * not a blocklist, so it doesn't need every regional/niche provider to be
 * useful.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'rediffmail.com',
]);

/**
 * member_count_risk_flag fires when BOTH of these hold: the account is
 * younger than NEW_ACCOUNT_DAYS_THRESHOLD days old, AND
 * expected_member_count exceeds MEMBER_COUNT_RISK_THRESHOLD. Either alone is
 * unremarkable — a week-old account asking for a 10-person club, or a
 * years-old account asking for a 200-person org, are both ordinary. It's
 * specifically the combination — brand-new account, org sized for hundreds
 * — that's worth a reviewer's second look.
 */
const NEW_ACCOUNT_DAYS_THRESHOLD = 7;
const MEMBER_COUNT_RISK_THRESHOLD = 50;

// EDIT (Phase 4 — cutover, subphase 4.3): submit() now also requires proof
// of control over org_email before the row is created, when one was
// supplied — see sendDomainOtp() and the 'ORG_DOMAIN_OWNERSHIP'-scoped
// verifyOtp() call inside submit() itself, and otp_verification's own
// schema comment for why a `purpose` column exists at all.

// EDIT (Phase 4 — cutover, subphase 4.4): submission cooldown.
//
// unique_open_org_request (2.1) already stops the same pid from having two
// *open* requests for the same *name* at once — but it says nothing about
// submission rate. It does nothing to stop a burst of requests for
// differently-named orgs, and nothing to stop an instant resubmission the
// moment a request is REJECTED (a closed row falls outside the partial
// index entirely). This cooldown closes that gap: no pid may submit again
// within SUBMIT_COOLDOWN_MS of their own most recent submission, full stop
// — regardless of that submission's name or current status.
//
// Same "look at the single most recent row" shape OtpService.sendOtp()'s
// own cooldown check already uses (identifier -> pid here), and the same
// HttpException(..., 429) shape it throws with — idx_org_requests_pid
// (pid, created_at DESC), added back in 2.1, was already sized for exactly
// this lookup; see that index's own comment.
//
// 15 minutes, not the OTP flow's 30 seconds: an org request is a
// deliberate, occasional action (most accounts will submit at most one,
// ever), not a retry-heavy flow like OTP delivery — a cap tight enough to
// stop automated bursts without getting in a genuine requester's way if
// they realize right away they made a typo and want to fix-and-resubmit
// (NEEDS_INFO's edit-and-resubmit path, 4.7, is the intended way to
// correct an *open* request without waiting out this cooldown at all,
// since editing doesn't call submit() again).
const SUBMIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class OrgRequestsService {
  constructor(
    private prisma: PrismaService,
    // EDIT (Phase 4 — cutover, subphase 4.3): OtpModule was added to
    // org.module.ts's imports for this — see that file's own comment.
    private otpService: OtpService,
    // EDIT (Phase 4 — cutover, subphase 4.5): registered as a provider
    // alongside this service in org.module.ts — see that file's own
    // comment on why it's a separate class.
    private emailService: OrgRequestEmailService,
  ) {}

  // ─── Send the domain-ownership OTP for a prospective org_email ─────────────
  // EDIT (Phase 4 — cutover, subphase 4.3): the send side of the check
  // submit() enforces below. Deliberately its own method/route rather than
  // folded into submit() itself — the requester needs the code delivered to
  // their inbox *before* they can fill in submit()'s org_email_otp field, so
  // this has to be a separate round trip the frontend calls first (mirrors
  // auth.controller.ts's own send-otp/verify-otp split, and identity wallet's
  // send-then-add-identity flow).
  //
  // Deliberately does not require the caller to already have a submitted
  // request, or check anything about org_name — verifying an email address
  // is independent of what org it will end up attached to, and requiring
  // sequencing here would just mean re-verifying on every edit-and-resubmit
  // cycle (4.7) if the requester changes org_name but keeps the same
  // org_email. It DOES require an authenticated session (this method's only
  // caller, OrgController.sendOrgDomainOtp(), sits behind the controller's
  // existing @UseGuards(JwtAuthGuard)) — an unauthenticated OTP-send endpoint
  // would just be a free email-bombing primitive.
  async sendDomainOtp(dto: SendOrgDomainOtpDto) {
    const orgEmail = dto.org_email.trim().toLowerCase();
    return this.otpService.sendOtp(orgEmail, 'ORG_DOMAIN_OWNERSHIP');
  }

  // ─── Submit a new organization request ──────────────────────────────────────
  async submit(pid: bigint, dto: SubmitOrgRequestDto) {
    // EDIT (Phase 4 — cutover, subphase 4.2): capture the account row —
    // requireUnifiedAccount() already fetches it for the existence/
    // contactability check, and the account-age signal below needs
    // created_at off the same row.
    const requester = await this.requireUnifiedAccount(pid);

    // ── Cooldown (subphase 4.4) ────────────────────────────────────────────
    // Checked before any normalisation/signal work below — it's a pure
    // per-pid rate gate, unrelated to what's actually in this submission,
    // so there's no reason to do the more expensive work (fuzzy name match,
    // domain OTP verification) first just to reject it here anyway. See
    // SUBMIT_COOLDOWN_MS's own comment for why this exists on top of
    // unique_open_org_request.
    const mostRecent = await this.findMostRecentRequest(pid);
    // FIX: `created_at` is typed nullable because the current Prisma
    // client predates the dbschema.sql/schema.prisma fix adding NOT NULL
    // to org_requests.created_at — it's always set by the column's own
    // DEFAULT at insert time and nothing ever writes it as NULL. The `!`
    // stays correct (and becomes a no-op) once the client is regenerated
    // from the fixed schema.
    if (
      mostRecent &&
      mostRecent.created_at! > new Date(Date.now() - SUBMIT_COOLDOWN_MS)
    ) {
      throw new HttpException(
        `Please wait before submitting another organization request. ` +
          `Your last submission (${mostRecent.reference_code}) was too recent.`,
        429,
      );
    }

    // Normalise before anything else, so every check below (and the row we
    // write) sees the same value.
    //
    // NOTE (flagged in 2.1's session notes): the DB's
    // chk_org_request_name_not_blank and the unique_open_org_request index
    // both normalise with btrim()/lower() themselves, so an untrimmed name
    // wouldn't break any constraint — it would just sit padded in the admin
    // review queue, and read back padded in the requester's own list. Trim
    // here so what's stored is what everyone sees.
    const orgName = dto.org_name.trim();
    if (orgName.length < 2) {
      throw new BadRequestException(
        'Organization name must be at least 2 characters.',
      );
    }

    const orgEmail = dto.org_email?.trim().toLowerCase() || null;
    const justification = dto.justification?.trim() || null;

    // Cheap pre-check for an existing open request for the same name by the
    // same account. This is only here to produce a useful message (naming the
    // reference code the requester should be looking at) instead of a bare
    // 409 — it does NOT close the race, exactly as with the orgid pre-check
    // in orgid.utilities.ts. The unique_open_org_request partial index is
    // what actually prevents the duplicate; see the catch below.
    const existing = await this.findOpenRequestByName(pid, orgName);
    if (existing) {
      throw new ConflictException(
        `You already have an open request for "${existing.org_name}" ` +
          `(reference ${existing.reference_code}, status ${existing.status}). ` +
          `Check its status instead of submitting it again.`,
      );
    }

    // ── Verification signals (subphase 4.2) ────────────────────────────────
    // Three independent, informational-only checks — see each helper/
    // constant's own comment for what it means and why its threshold is
    // what it is. None of these can block or reject the submission; they
    // exist purely so 3.5's request-detail page (a later subphase) has more
    // for the reviewing admin to go on than the requester's own
    // justification text.
    const nameMatch = await this.findClosestOrgNameMatch(orgName);
    const orgEmailIsFreeDomain = this.isFreeEmailDomain(orgEmail);
    // FIX: same nullable-Prisma-client-vs-fixed-schema gap as
    // findMostRecentRequest()'s created_at above — see that comment.
    const accountAgeDays = Math.floor(
      (Date.now() - requester.created_at!.getTime()) / (1000 * 60 * 60 * 24),
    );
    const memberCountRiskFlag =
      dto.expected_member_count != null &&
      dto.expected_member_count > MEMBER_COUNT_RISK_THRESHOLD &&
      accountAgeDays < NEW_ACCOUNT_DAYS_THRESHOLD;

    // ── Domain-ownership check (subphase 4.3) ──────────────────────────────
    // Only applies when org_email was supplied — with none, there's no
    // address to prove control of, and SubmitOrgRequestDto's own
    // @ValidateIf already guarantees org_email_otp is present whenever
    // org_email is (a request with org_email but no otp never reaches here;
    // class-validator rejects it before the controller calls submit() at
    // all). verifyOtp() throws BadRequestException on a missing/expired/
    // wrong code, which propagates out of submit() as-is — same shape as
    // every other precondition check in this method.
    const orgEmailVerified = !!orgEmail;
    if (orgEmail) {
      await this.otpService.verifyOtp(
        orgEmail,
        dto.org_email_otp!,
        'ORG_DOMAIN_OWNERSHIP',
      );
    }

    try {
      const request = await this.prisma.org_requests.create({
        data: {
          pid,
          org_name: orgName,
          org_email: orgEmail,
          expected_member_count: dto.expected_member_count ?? null,
          justification,
          name_similarity_score: nameMatch?.score ?? null,
          name_similarity_match: nameMatch?.org_name ?? null,
          org_email_is_free_domain: orgEmailIsFreeDomain,
          requester_account_age_days: accountAgeDays,
          member_count_risk_flag: memberCountRiskFlag,
          org_email_verified: orgEmailVerified,
          // status and reference_code are deliberately not set here — the
          // schema defaults them ('PENDING', and a sequence-backed
          // 'ORQ-0000000' reference). Generating the reference in
          // application code would mean a second uniqueness problem to
          // solve, for a value that carries no meaning.
        },
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          status: true,
          created_at: true,
        },
      });

      // EDIT (Phase 4 — cutover, subphase 4.5): fire the "request received"
      // notification now that the row genuinely exists — after the create
      // succeeds, not inside the try's happy path speculatively, so a
      // caught-and-rethrown error above (the P2002 branch below) can never
      // still have sent a "received" email for a request that doesn't
      // exist. Awaited (not fire-and-forget) for the same reason every
      // other side effect in this method is synchronous with the request —
      // dispatch() itself never throws (see its own header comment), so
      // this cannot turn a successful submission into a failed response.
      await this.emailService.sendRequestReceived(
        requester.email,
        request.reference_code,
        request.org_name,
      );

      return {
        ...request,
        message:
          `Request submitted. Your tracking reference is ${request.reference_code}. ` +
          `You'll be notified once it has been reviewed.`,
      };
    } catch (err) {
      // Lost the race against a concurrent double-submit (two clicks, two
      // tabs). The partial unique index caught it; turn it into the same
      // message the pre-check above would have given.
      if (this.isOpenRequestConflict(err)) {
        throw new ConflictException(
          `You already have an open request for "${orgName}". ` +
            `Check its status instead of submitting it again.`,
        );
      }
      throw err;
    }
  }

  // ─── Approve a pending request ───────────────────────────────────────────────
  // EDIT (Phase 2 — subphase 2.4): originally created the `organization` row
  // itself (runWithUniqueOrgId() + createOrganizationCore()), marked the
  // request APPROVED, and wrote the admin_audit_log line, all in one
  // transaction.
  //
  // EDIT (Phase 6 — post-approval org finalization, subphase 6.2): stops
  // doing any of that. An admin approving a request is no longer the same
  // moment an organization comes into existence — see this plan's own "Why
  // this is a phase, not a patch" header for the reasoning. approve() now
  // only records the admin's sign-off and the member cap they're setting
  // (admin_set_member_limit), and moves the request to the new
  // 'APPROVED_PENDING_SETUP' status. Creating the organization itself is
  // finalizeSetup() (6.3)'s job — a requester-triggered action, not an
  // admin one — which is why generateInitialOwnerUid(), runWithUniqueOrgId(),
  // and createOrganizationCore() no longer appear below (they move to
  // finalizeSetup() in 6.3 instead).
  async approve(
    requestId: bigint,
    adminId: string,
    dto: ApproveOrgRequestDto,
  ) {
    // Defense in depth, not a fix to the guard: SiteAdminGuard (1.3)
    // confirms the caller's *session* is valid and SITEADMIN, but its
    // strategy only checks site_admins.is_active at login time (see
    // site-admin-jwt.strategy.ts) — a token issued before an admin was
    // deactivated stays usable for as long as the session itself is active.
    // Approving a request commits the platform to a member cap for an org
    // that will eventually exist; re-checking here costs one query and
    // closes that window for this specific adverse action, without trying
    // to fix the guard itself (out of this subphase's scope).
    await this.requireActiveSiteAdmin(adminId);

    // Pre-fetch purely for a fast, friendly error. This does NOT close the
    // race against a second admin approving/rejecting the same request
    // concurrently — the SELECT ... FOR UPDATE inside the transaction below
    // does that. Same two-layer shape as reject()/requestInfo().
    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Request ${request.reference_code} is already ${request.status} ` +
          `and cannot be approved.`,
      );
    }

    // The requester must still have a contact on file — same requirement
    // submit() enforced when the request was created, re-checked here
    // because approval can happen long after submission. They'll need this
    // contact again at finalizeSetup() (6.3) time and for the email sent
    // below. Mirrors IdentityService.requireUnifiedAccount().
    const requester = await this.requireUnifiedAccount(request.pid);

    // dto.member_limit's own positivity is enforced by ApproveOrgRequestDto's
    // @Min(1) — no redundant check needed here the way orgName.length /
    // resolveReviewNotes() guard against class-validator gaps elsewhere in
    // this file (@IsInt()/@Min(1) has no equivalent "technically valid but
    // blank" gap the way an @IsNotEmpty() string does).
    const memberLimit = dto.member_limit;

    const result = await this.prisma.$transaction(async (tx) => {
      // Same lock-then-write shape as reject()/requestInfo(), and the same
      // reasoning approve() itself used to rely on before 6.2: SELECT ...
      // FOR UPDATE locks the request row first, so a concurrent reviewer on
      // the same request_id blocks until this transaction commits or rolls
      // back, then re-reads a status that's no longer open. There's no
      // organization row involved in this transaction any more, so none of
      // the claim-then-create-vs-create-then-claim reasoning the old
      // approve() needed (see git history) applies here.
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          status: string;
          reference_code: string;
          org_name: string;
        }>
      >`
        SELECT request_id, status, reference_code, org_name
        FROM org_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      // Only reachable if the row was deleted between the pre-fetch above
      // and here — org_requests has no delete path anywhere in the
      // codebase (same unexercised-guard note as reject()).
      if (!claimed) {
        throw new NotFoundException(`Org request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Request ${claimed.reference_code} was already reviewed by someone else.`,
        );
      }

      const updated = await tx.org_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'APPROVED_PENDING_SETUP',
          admin_set_member_limit: memberLimit,
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          // approved_orgid/setup_completed_at stay NULL —
          // chk_org_request_review_consistency requires exactly that for
          // APPROVED_PENDING_SETUP; finalizeSetup() (6.3) sets both later.
        },
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_REQUEST_APPROVED',
          target_type: 'ORG_REQUEST',
          target_id: String(requestId),
          // orgid/owner_uid no longer exist at this point in the flow (see
          // this method's own header comment) — metadata now carries the
          // decision that WAS made here instead: the member cap.
          metadata: {
            member_limit: memberLimit,
            org_name: updated.org_name,
          },
        },
      });

      return updated;
    });

    // EDIT (Phase 6 — subphase 6.2): sendApproved() (orgid-bearing) moves to
    // finalizeSetup() (6.3) — this is the new "approved, action needed"
    // notification instead, sent once the transaction above has committed,
    // same "don't email for a decision that got rolled back" reasoning the
    // old approve() used for sendApproved().
    await this.emailService.sendApprovedPendingSetup(
      requester.email,
      result.reference_code,
      result.org_name,
    );

    return {
      request_id: requestId,
      status: result.status,
      reference_code: result.reference_code,
      org_name: result.org_name,
      admin_set_member_limit: memberLimit,
      message:
        `Request ${result.reference_code} approved. "${result.org_name}"'s member limit ` +
        `has been set to ${memberLimit}. The requester must now complete setup before ` +
        `the organization is created.`,
    };
  }

  // ─── Finalize setup: the requester actually creates the organization ────────
  // EDIT (Phase 6 — post-approval org finalization, subphase 6.3): the other
  // half of the split approve() (6.2) started. An admin's approve() only
  // gets a request to 'APPROVED_PENDING_SETUP' — this is what the
  // requester calls afterward to actually bring the organization into
  // existence, choosing the orgid, confirming the org's contact email, and
  // supplying their own uid. Reuses runWithUniqueOrgId()/
  // createOrganizationCore() exactly as registerOrg() does — see this
  // file's own header comment on the plan for why those were left imported,
  // unused, through 6.2.
  async finalizeSetup(
    requestId: bigint,
    pid: bigint,
    dto: FinalizeOrgRequestDto,
  ) {
    // Authorization: this is the requester's own action, not an admin one —
    // no SiteAdminGuard on the route, just the same authenticated-unified-
    // account check submit()/resubmit() already use. Also doubles as the
    // source of the owner's contact (identifier) below: requireUnifiedAccount()
    // already guarantees at least one of email/mobile is set.
    const requester = await this.requireUnifiedAccount(pid);

    // Fast, unlocked pre-check — same two-layer shape as resubmit()/
    // approve(): a request_id that exists but belongs to a different pid is
    // reported identically to one that doesn't exist at all, so this can't
    // be used to probe for other accounts' requests. The lock inside the
    // transaction below is what actually closes the race against a second
    // finalize call.
    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request || request.pid !== pid) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (request.status !== 'APPROVED_PENDING_SETUP') {
      throw new ConflictException(
        `Request ${request.reference_code} is ${request.status}, not ` +
          `APPROVED_PENDING_SETUP — there is nothing to finalize.`,
      );
    }

    // ── Org email: confirm, or re-verify if changed ────────────────────────
    // Required in this DTO even though org_requests.org_email may already
    // be OTP-verified from submission (4.3) — real-world time may have
    // passed since then. Only re-run the domain-ownership OTP flow when the
    // value actually changed; an unchanged, already-verified email doesn't
    // need proving twice.
    const newOrgEmail = dto.org_email.trim().toLowerCase();
    const previousOrgEmail = request.org_email?.trim().toLowerCase() ?? null;
    if (newOrgEmail !== previousOrgEmail) {
      if (!dto.org_email_otp) {
        throw new BadRequestException(
          'org_email has changed since submission. Send a new verification code ' +
            'to it via POST /org/request/send-domain-otp, then include it as ' +
            'org_email_otp.',
        );
      }
      await this.otpService.verifyOtp(
        newOrgEmail,
        dto.org_email_otp,
        'ORG_DOMAIN_OWNERSHIP',
      );
    }

    const ownerUid = dto.owner_uid.trim().toUpperCase();

    // requireUnifiedAccount() guarantees at least one of these is set — this
    // is unreachable defense-in-depth, not a real branch, kept for the same
    // reason approve()'s own "unreachable" guards are (see e.g. its
    // !claimed check above).
    const identifier = requester.email ?? requester.mobile;
    if (!identifier) {
      throw new ForbiddenException(
        'An email or mobile contact is required to complete setup.',
      );
    }

    const preferredOrgId =
      dto.orgid_choice.mode === 'preferred'
        ? dto.orgid_choice.orgid
        : undefined;

    const { orgid, result } = await runWithUniqueOrgId(
      this.prisma,
      { orgName: request.org_name, preferredOrgId },
      async (tx, orgid) => {
        // Same lock-then-write shape approve() used before 6.2, and the
        // same race it's guarding against: a second finalize call (or the
        // request somehow re-entering review) firing between the pre-fetch
        // above and here must not double-create an organization for this
        // request. Re-reads status under the lock rather than trusting the
        // pre-fetch.
        const locked = await tx.$queryRaw<
          Array<{
            request_id: bigint;
            pid: bigint;
            status: string;
            reference_code: string;
            org_name: string;
            admin_set_member_limit: number | null;
          }>
        >`
          SELECT request_id, pid, status, reference_code, org_name, admin_set_member_limit
          FROM org_requests
          WHERE request_id = ${requestId}
          FOR UPDATE
        `;
        const claimed = locked[0];
        // Only reachable if the row was deleted between the pre-fetch above
        // and here — org_requests has no delete path anywhere in the
        // codebase (same unexercised-guard note as approve()/reject()).
        if (!claimed || claimed.pid !== pid) {
          throw new NotFoundException(`Org request ${requestId} not found`);
        }
        if (claimed.status !== 'APPROVED_PENDING_SETUP') {
          throw new ConflictException(
            `Request ${claimed.reference_code} is ${claimed.status}, not ` +
              `APPROVED_PENDING_SETUP — setup has already been completed, ` +
              `or the request is no longer open.`,
          );
        }
        // Unreachable given chk_org_request_review_consistency (a request
        // can't sit in APPROVED_PENDING_SETUP without admin_set_member_limit
        // set) — defense-in-depth, not a real branch.
        if (claimed.admin_set_member_limit == null) {
          throw new ConflictException(
            `Request ${claimed.reference_code} has no member limit set.`,
          );
        }

        const creation = await createOrganizationCore(
          tx,
          orgid,
          claimed.org_name,
          {
            orgEmail: newOrgEmail,
            owner: { pid, uid: ownerUid, identifier },
            // Carried straight from the admin's approve()-time decision —
            // see OrgCreationParams.memberLimit's own comment for why this
            // is set at INSERT time rather than a follow-up UPDATE.
            memberLimit: claimed.admin_set_member_limit,
          },
        );

        const updatedRequest = await tx.org_requests.update({
          where: { request_id: requestId },
          data: {
            status: 'APPROVED',
            approved_orgid: orgid,
            setup_completed_at: new Date(),
            // Persist the (possibly re-confirmed/changed) email — this is
            // the value that's actually verified and going onto the org
            // itself, so the request row should agree with it going
            // forward rather than keep showing whatever was there at
            // submission time.
            org_email: newOrgEmail,
          },
          select: { reference_code: true, org_name: true },
        });

        return { creation, updatedRequest };
      },
    );

    // EDIT (Phase 6 — subphase 6.3): sendApproved() (orgid-bearing) moves
    // here from approve() (6.2) — there's now an orgid and an owner
    // membership to actually report. Sent after the transaction commits,
    // same "don't email for something that got rolled back" reasoning
    // every other notification in this file follows.
    await this.emailService.sendApproved(
      requester.email,
      result.updatedRequest.reference_code,
      result.updatedRequest.org_name,
      orgid,
    );

    return {
      request_id: requestId,
      status: 'APPROVED' as const,
      reference_code: result.updatedRequest.reference_code,
      org_name: result.updatedRequest.org_name,
      orgid,
      root_scope_id: result.creation.rootScope.scope_id,
      message: `Organization "${result.updatedRequest.org_name}" has been created with ID ${orgid}.`,
    };
  }

  // ─── Reject a pending/needs-info request ─────────────────────────────────────
  // EDIT (Phase 2 — subphase 2.5): terminal, adverse outcome. No organization
  // is created and no orgid is allocated, so this doesn't need
  // runWithUniqueOrgId() the way approve() does — just a status flip. Reuses
  // approve()'s SELECT ... FOR UPDATE lock shape (see that method's notes on
  // why claim-then-act was abandoned in favour of lock-then-write) purely for
  // consistency between the three outcomes: a concurrent reject() racing an
  // approve() or requestInfo() on the same request_id blocks on the same
  // lock and then sees a status that's already closed/changed.
  async reject(requestId: bigint, adminId: string, dto: ReviewOrgRequestDto) {
    await this.requireActiveSiteAdmin(adminId);

    // Fast, unlocked pre-check for a friendly error — same two-layer shape
    // as approve(): this does NOT close the race against a concurrent
    // reviewer, the lock inside the transaction does that.
    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Request ${request.reference_code} is already ${request.status} ` +
          `and cannot be rejected.`,
      );
    }

    const { reviewNote, internalReason } = this.resolveReviewNotes(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          status: string;
          reference_code: string;
          org_name: string;
        }>
      >`
        SELECT request_id, status, reference_code, org_name
        FROM org_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      // Only reachable if the row was deleted between the pre-fetch above
      // and here — org_requests has no delete path anywhere in the
      // codebase (same unexercised-guard note as approve()).
      if (!claimed) {
        throw new NotFoundException(`Org request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Request ${claimed.reference_code} was already reviewed by someone else.`,
        );
      }

      const updated = await tx.org_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'REJECTED',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          review_note: reviewNote,
          // approved_orgid stays NULL — chk_org_request_review_consistency
          // requires exactly that for REJECTED.
        },
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_REQUEST_REJECTED',
          target_type: 'ORG_REQUEST',
          target_id: String(requestId),
          reason: internalReason,
          metadata: {
            reference_code: updated.reference_code,
            org_name: updated.org_name,
          },
        },
      });

      return updated;
    });

    // EDIT (Phase 4 — cutover, subphase 4.5): sent after the transaction
    // commits, using `request.pid` from the pre-check above — pid is
    // immutable on an existing row (never written by update() anywhere in
    // this file), so there's no staleness risk in reading it from the
    // unlocked pre-fetch rather than re-reading it inside the transaction
    // the way approve() does for the fields that DO change under the lock.
    const requester = await this.prisma.uaccount.findUnique({
      where: { pid: request.pid },
      select: { email: true },
    });
    await this.emailService.sendRejected(
      requester?.email ?? null,
      result.reference_code,
      result.org_name,
      reviewNote,
    );

    return {
      ...result,
      message: `Request ${result.reference_code} has been rejected.`,
    };
  }

  // ─── Send a request back for more information ────────────────────────────────
  // EDIT (Phase 2 — subphase 2.5): non-terminal — the request stays open, and
  // 4.7's "My requests" view is what will let the requester edit and
  // resubmit it. Structurally identical to reject() (same lock, same shape
  // of write) except for the target status and the one extra DB-enforced
  // requirement: chk_org_request_needs_info_note means review_note cannot be
  // left NULL for NEEDS_INFO, which resolveReviewNotes()/ReviewOrgRequestDto
  // already guarantee by making `reason` required.
  async requestInfo(
    requestId: bigint,
    adminId: string,
    dto: ReviewOrgRequestDto,
  ) {
    await this.requireActiveSiteAdmin(adminId);

    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (!this.isOpenStatus(request.status)) {
      throw new ConflictException(
        `Request ${request.reference_code} is already ${request.status} ` +
          `and cannot be sent back for more information.`,
      );
    }

    const { reviewNote, internalReason } = this.resolveReviewNotes(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          status: string;
          reference_code: string;
          org_name: string;
        }>
      >`
        SELECT request_id, status, reference_code, org_name
        FROM org_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Org request ${requestId} not found`);
      }
      if (!this.isOpenStatus(claimed.status)) {
        throw new ConflictException(
          `Request ${claimed.reference_code} was already reviewed by someone else.`,
        );
      }

      const updated = await tx.org_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'NEEDS_INFO',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          review_note: reviewNote,
        },
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_REQUEST_INFO_REQUESTED',
          target_type: 'ORG_REQUEST',
          target_id: String(requestId),
          reason: internalReason,
          metadata: {
            reference_code: updated.reference_code,
            org_name: updated.org_name,
          },
        },
      });

      return updated;
    });

    // EDIT (Phase 4 — cutover, subphase 4.5): same reasoning as reject()'s
    // own copy of this — pid is immutable, so reading it off the unlocked
    // pre-check is safe, and this is the one message of the four whose
    // whole point is the review_note text the admin just wrote, not just
    // the status change.
    const requester = await this.prisma.uaccount.findUnique({
      where: { pid: request.pid },
      select: { email: true },
    });
    await this.emailService.sendNeedsInfo(
      requester?.email ?? null,
      result.reference_code,
      result.org_name,
      reviewNote,
    );

    return {
      ...result,
      message: `Request ${result.reference_code} sent back to the requester for more information.`,
    };
  }

  // ─── Revoke a stale approval (subphase 6.6) ────────────────────────────────
  // EDIT (Phase 6 — post-approval org setup, subphase 6.6): the admin side
  // of the "requester never finishes setup" gap 6.1's schema comment and
  // idx_org_requests_pending_setup both anticipated. Per the plan's own
  // "Open decisions" answer: a manual revoke action, no automated
  // expiry/reversal — this is that manual action, not a cron job.
  //
  // Only reachable from APPROVED_PENDING_SETUP (not the OPEN_ORG_REQUEST_
  // STATUSES reject()/requestInfo()/approve() gate on) — a request that's
  // still PENDING/NEEDS_INFO was never approved in the first place (reject()
  // is the right call there), and APPROVED/REJECTED are already terminal.
  // Lands on REJECTED, same terminal status reject() itself uses: the
  // organization never came to exist, so there is nothing to "un-approve"
  // beyond the request row itself, and REJECTED is what frees the org name
  // back up for a future submission (unique_open_org_request's WHERE clause
  // does not include REJECTED — see 2.1). admin_set_member_limit is left as
  // it was set at approval time rather than cleared: it's a historical
  // record of what was decided, not a live value anything still reads once
  // the row is REJECTED, and chk_org_request_review_consistency's REJECTED
  // branch has no opinion on it either way.
  async revokeApproval(
    requestId: bigint,
    adminId: string,
    dto: ReviewOrgRequestDto,
  ) {
    await this.requireActiveSiteAdmin(adminId);

    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (request.status !== 'APPROVED_PENDING_SETUP') {
      throw new ConflictException(
        `Request ${request.reference_code} is ${request.status}, not ` +
          `APPROVED_PENDING_SETUP — only a pending-setup approval can be revoked.`,
      );
    }

    const { reviewNote, internalReason } = this.resolveReviewNotes(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      // Same lock-then-recheck shape as approve()/reject()/requestInfo():
      // guards against a race with the requester's own finalizeSetup()
      // call landing concurrently (or a second admin's revoke/reject on
      // the same row) — whichever transaction locks the row first wins,
      // and the loser sees a status that's no longer APPROVED_PENDING_SETUP.
      const locked = await tx.$queryRaw<
        Array<{
          request_id: bigint;
          status: string;
          reference_code: string;
          org_name: string;
        }>
      >`
        SELECT request_id, status, reference_code, org_name
        FROM org_requests
        WHERE request_id = ${requestId}
        FOR UPDATE
      `;
      const claimed = locked[0];
      if (!claimed) {
        throw new NotFoundException(`Org request ${requestId} not found`);
      }
      if (claimed.status !== 'APPROVED_PENDING_SETUP') {
        throw new ConflictException(
          `Request ${claimed.reference_code} is no longer awaiting setup ` +
            `(now ${claimed.status}) — it may have just been finalized or ` +
            `already revoked.`,
        );
      }

      const updated = await tx.org_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'REJECTED',
          reviewed_by_admin_id: adminId,
          reviewed_at: new Date(),
          review_note: reviewNote,
          // approved_orgid/setup_completed_at were already NULL (guaranteed
          // by chk_org_request_review_consistency's APPROVED_PENDING_SETUP
          // branch) and stay that way — REJECTED requires exactly that.
        },
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          status: true,
        },
      });

      await tx.admin_audit_log.create({
        data: {
          admin_id: adminId,
          action: 'ORG_REQUEST_APPROVAL_REVOKED',
          target_type: 'ORG_REQUEST',
          target_id: String(requestId),
          reason: internalReason,
          metadata: {
            reference_code: updated.reference_code,
            org_name: updated.org_name,
            previous_status: 'APPROVED_PENDING_SETUP',
          },
        },
      });

      return updated;
    });

    // Same "read pid off the unlocked pre-check, it's immutable" reasoning
    // as reject()/requestInfo()'s own copy of this.
    const requester = await this.prisma.uaccount.findUnique({
      where: { pid: request.pid },
      select: { email: true },
    });
    await this.emailService.sendApprovalRevoked(
      requester?.email ?? null,
      result.reference_code,
      result.org_name,
      reviewNote,
    );

    return {
      ...result,
      message: `Approval for ${result.reference_code} has been revoked.`,
    };
  }

  // ─── Stuck-request admin view (subphase 6.6) ───────────────────────────────
  /**
   * Requests sitting in APPROVED_PENDING_SETUP for longer than `minHours`,
   * oldest-approved-first — queries idx_org_requests_pending_setup (6.1)
   * directly, per that index's own comment ("don't add a second index for
   * the same purpose"). Purely visibility, same as the plan's own framing:
   * nothing here reverses or expires a request automatically, it just
   * surfaces candidates for an admin to look at and, if they choose,
   * revoke via revokeApproval() above.
   */
  async listStuckPendingSetup(minHours = 24) {
    const hours = minHours > 0 ? minHours : 0;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const requests = await this.prisma.org_requests.findMany({
      where: {
        status: 'APPROVED_PENDING_SETUP',
        reviewed_at: { lte: cutoff },
      },
      orderBy: { reviewed_at: 'asc' },
      select: {
        request_id: true,
        reference_code: true,
        org_name: true,
        org_email: true,
        admin_set_member_limit: true,
        reviewed_at: true,
        reviewed_by_admin_id: true,
        pid: true,
      },
    });

    return { requests, min_hours: hours, count: requests.length };
  }

  // ─── Admin review queue + detail (subphase 3.1) ──────────────────────────────
  // EDIT (Phase 3 — subphase 3.1): read-only. Phase 2 never needed these —
  // submit()/approve()/reject()/requestInfo() are all write paths — but the
  // admin controller landing in this subphase does: a queue to review and a
  // detail view per request.

  /**
   * The admin review queue. Defaults to open requests only (PENDING +
   * NEEDS_INFO) — an admin opening the queue wants work to do, not a full
   * history — ordered oldest-first *within* a status, matching
   * idx_org_requests_status's (status, created_at) shape exactly (the plan's
   * own description of what this index is for). Pass `status` to narrow to
   * specific statuses instead, e.g. browsing closed (APPROVED/REJECTED)
   * requests for context on a similar new one.
   */
  async list(
    options: {
      status?: string[];
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const statuses = this.resolveStatusFilter(options.status);
    const page =
      options.page && options.page > 0 ? Math.floor(options.page) : 1;
    // Capped at 100 — this is an admin queue, not a public export endpoint,
    // but an uncapped page_size is still an easy way to force one very
    // expensive query.
    const pageSize =
      options.pageSize && options.pageSize > 0
        ? Math.min(Math.floor(options.pageSize), 100)
        : 25;

    const where = { status: { in: statuses } };

    const [total, requests] = await this.prisma.$transaction([
      this.prisma.org_requests.count({ where }),
      this.prisma.org_requests.findMany({
        where,
        orderBy: [{ status: 'asc' }, { created_at: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          request_id: true,
          reference_code: true,
          org_name: true,
          org_email: true,
          expected_member_count: true,
          status: true,
          created_at: true,
          updated_at: true,
          pid: true,
        },
      }),
    ]);

    return { requests, total, page, page_size: pageSize };
  }

  /**
   * Request detail (3.5's detail page): the request row, the requester's
   * unified-account contact info, the reviewing admin if the request has
   * been reviewed, and the full admin_audit_log trail for this request —
   * every past approve/reject/request-info decision on it, so a NEEDS_INFO
   * round trip's whole history is visible, not just its current state.
   *
   * Deliberately three separate queries rather than a Prisma `include` for
   * the pid -> uaccount and reviewed_by_admin_id -> site_admins relations:
   * the relation field names a real `prisma db pull` would generate for
   * them aren't knowable in this sandbox (the regen has been an outstanding
   * item since 1.1/2.1 — see PROGRESS.md), so guessing at one risks a name
   * that doesn't match the real client. Mirrors approve()'s own choice
   * (`tx.uaccount.findUniqueOrThrow({ where: { pid: claimed.pid } })` as its
   * own query rather than an include) for the same reason.
   */
  async getDetail(requestId: bigint) {
    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }

    const [requester, reviewer, auditTrail] = await Promise.all([
      this.prisma.uaccount.findUnique({
        where: { pid: request.pid },
        select: {
          pid: true,
          first_name: true,
          middle_name: true,
          last_name: true,
          email: true,
          mobile: true,
        },
      }),
      request.reviewed_by_admin_id
        ? this.prisma.site_admins.findUnique({
            where: { admin_id: request.reviewed_by_admin_id },
            select: { admin_id: true, name: true },
          })
        : Promise.resolve(null),
      this.prisma.admin_audit_log.findMany({
        where: { target_type: 'ORG_REQUEST', target_id: String(requestId) },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return { ...request, requester, reviewer, audit_trail: auditTrail };
  }

  // ─── Requester's own requests + edit-and-resubmit (subphase 4.7) ──────────
  // EDIT (Phase 4 — cutover, subphase 4.7): the requester-facing counterpart
  // to 3.1's admin list()/getDetail() — listMine() is the "My requests"
  // view's data source, and resubmit() is what a NEEDS_INFO round trip
  // actually does: edits the SAME row and flips it back to PENDING, rather
  // than calling submit() again (see SUBMIT_COOLDOWN_MS's own comment,
  // subphase 4.4, for why that distinction matters — a resubmit must not be
  // blocked by the cooldown meant to slow down repeat *new* submissions).

  /**
   * All of this pid's own requests, newest first. Deliberately a narrower
   * projection than list()/getDetail() (3.1, admin-facing): the four
   * verification-signal columns from 4.2 (name_similarity_score/_match,
   * org_email_is_free_domain, requester_account_age_days,
   * member_count_risk_flag) are reviewer-only context about the requester —
   * that schema comment says so explicitly — not something to show the
   * requester about themselves, so they're excluded here rather than
   * filtered client-side.
   */
  async listMine(pid: bigint) {
    return this.prisma.org_requests.findMany({
      where: { pid },
      orderBy: { created_at: 'desc' },
      select: {
        request_id: true,
        reference_code: true,
        org_name: true,
        org_email: true,
        expected_member_count: true,
        justification: true,
        status: true,
        review_note: true,
        reviewed_at: true,
        approved_orgid: true,
        // EDIT (Phase 6 — post-approval org finalization, subphase 6.5):
        // the finalize-setup wizard's review step shows this read-only
        // (per the plan: "not editable here — see Phase 7 for how it
        // changes later") — it's the one field an APPROVED_PENDING_SETUP
        // row needs that wasn't already selected here. Still excluded:
        // the 4.2 verification-signal columns (reviewer-only, per this
        // method's own comment above) and setup_completed_at (not shown
        // anywhere in the UI yet — nothing in 6.5 asks for it).
        admin_set_member_limit: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Edits a NEEDS_INFO request in place and sends it back to PENDING — the
   * "resubmit" half of a NEEDS_INFO round trip. Deliberately NOT a call to
   * submit(): that would create a second row (2.1's audit trigger on
   * org_requests exists specifically so this UPDATE's diff is preserved
   * instead — "the row alone doesn't preserve what was originally
   * claimed", per that subphase's own note) and would be subject to
   * SUBMIT_COOLDOWN_MS, which exists to slow down repeat *new* submissions,
   * not to make a requester wait 15 minutes to answer a question about a
   * request they already have open.
   *
   * Only reachable from NEEDS_INFO — a PENDING request is already awaiting
   * its first review (nothing to fix yet), and APPROVED/REJECTED are
   * terminal. `dto` is the same SubmitOrgRequestDto submit() takes: same
   * fields, same validation, same @ValidateIf requirement that
   * org_email_otp accompany org_email. Note this means org_email must be
   * re-verified even if it's unchanged from the original submission — a
   * deliberate simplification rather than diffing against the stored value
   * to decide whether re-verification is needed.
   */
  async resubmit(pid: bigint, requestId: bigint, dto: SubmitOrgRequestDto) {
    const requester = await this.requireUnifiedAccount(pid);

    // Fast, unlocked pre-check — same two-layer shape every review-outcome
    // method in this file uses; the lock inside the transaction below is
    // what actually closes the race. A request_id that exists but belongs
    // to a different pid is reported identically to one that doesn't exist
    // at all, so this can't be used to probe for other accounts' requests.
    const request = await this.prisma.org_requests.findUnique({
      where: { request_id: requestId },
    });
    if (!request || request.pid !== pid) {
      throw new NotFoundException(`Org request ${requestId} not found`);
    }
    if (request.status !== 'NEEDS_INFO') {
      throw new ConflictException(
        `Request ${request.reference_code} is ${request.status}, not NEEDS_INFO — ` +
          `there is nothing to resubmit.`,
      );
    }

    const orgName = dto.org_name.trim();
    if (orgName.length < 2) {
      throw new BadRequestException(
        'Organization name must be at least 2 characters.',
      );
    }
    const orgEmail = dto.org_email?.trim().toLowerCase() || null;
    const justification = dto.justification?.trim() || null;

    // Same duplicate-open-name pre-check submit() runs, but excluding this
    // very row — it already counts as one of this pid's own open requests
    // under unique_open_org_request, so without the exclusion an unchanged
    // name would look like a collision with itself.
    const existing = await this.prisma.org_requests.findFirst({
      where: {
        pid,
        org_name: { equals: orgName, mode: 'insensitive' },
        status: { in: [...OPEN_ORG_REQUEST_STATUSES] },
        request_id: { not: requestId },
      },
      select: { reference_code: true, org_name: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        `You already have an open request for "${existing.org_name}" ` +
          `(reference ${existing.reference_code}, status ${existing.status}). ` +
          `Check its status instead.`,
      );
    }

    // Verification signals + domain-ownership check recomputed fresh, the
    // same way submit() computes them — this is a new review cycle for the
    // edited content, even though it's the same row.
    const nameMatch = await this.findClosestOrgNameMatch(orgName);
    const orgEmailIsFreeDomain = this.isFreeEmailDomain(orgEmail);
    // FIX: same nullable-Prisma-client-vs-fixed-schema gap noted in
    // submit() above.
    const accountAgeDays = Math.floor(
      (Date.now() - requester.created_at!.getTime()) / (1000 * 60 * 60 * 24),
    );
    const memberCountRiskFlag =
      dto.expected_member_count != null &&
      dto.expected_member_count > MEMBER_COUNT_RISK_THRESHOLD &&
      accountAgeDays < NEW_ACCOUNT_DAYS_THRESHOLD;

    const orgEmailVerified = !!orgEmail;
    if (orgEmail) {
      await this.otpService.verifyOtp(
        orgEmail,
        dto.org_email_otp!,
        'ORG_DOMAIN_OWNERSHIP',
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{
            request_id: bigint;
            pid: bigint;
            status: string;
            reference_code: string;
          }>
        >`
          SELECT request_id, pid, status, reference_code
          FROM org_requests
          WHERE request_id = ${requestId}
          FOR UPDATE
        `;
        const claimed = locked[0];
        if (!claimed || claimed.pid !== pid) {
          throw new NotFoundException(`Org request ${requestId} not found`);
        }
        if (claimed.status !== 'NEEDS_INFO') {
          throw new ConflictException(
            `Request ${claimed.reference_code} is no longer NEEDS_INFO — ` +
              `it may have been reviewed again while you were editing it.`,
          );
        }

        return tx.org_requests.update({
          where: { request_id: requestId },
          data: {
            org_name: orgName,
            org_email: orgEmail,
            expected_member_count: dto.expected_member_count ?? null,
            justification,
            name_similarity_score: nameMatch?.score ?? null,
            name_similarity_match: nameMatch?.org_name ?? null,
            org_email_is_free_domain: orgEmailIsFreeDomain,
            requester_account_age_days: accountAgeDays,
            member_count_risk_flag: memberCountRiskFlag,
            org_email_verified: orgEmailVerified,
            status: 'PENDING',
            // reviewed_by_admin_id/reviewed_at/review_note are deliberately
            // left as-is — they're the record of the most recent review
            // that actually happened, not something this UPDATE un-does;
            // the next review (approve/reject/requestInfo) overwrites them
            // same as it would for a first-time PENDING request.
          },
          select: {
            request_id: true,
            reference_code: true,
            org_name: true,
            status: true,
            updated_at: true,
          },
        });
      });

      // EDIT (subphase 4.7): reuses the "request received" notification —
      // from the requester's perspective a resubmission is the same event
      // (their request is back in the queue awaiting review). No dedicated
      // "resubmitted" template exists; flagged as a possible future
      // addition rather than invented here, out of this subphase's scope.
      await this.emailService.sendRequestReceived(
        requester.email,
        result.reference_code,
        result.org_name,
      );

      return {
        ...result,
        message: `Request resubmitted. It's back in the review queue.`,
      };
    } catch (err) {
      if (this.isOpenRequestConflict(err)) {
        throw new ConflictException(
          `You already have an open request for "${orgName}". Check its status instead.`,
        );
      }
      throw err;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * An org request is an accountability record tied to a real account: it's
   * how the reviewing admin knows who is asking, and how 4.5 emails them
   * about the outcome. Mirrors IdentityService.requireUnifiedAccount().
   *
   * EDIT (Phase 4 — cutover, subphase 4.2): now returns the fetched
   * `uaccount` row instead of void — submit() needs `created_at` off it for
   * the account-age signal, and refetching it a second time right after
   * this call already fetched it would be wasteful. approve()'s call site
   * (which only needed the existence/contactability check) is unaffected —
   * it simply doesn't use the return value.
   */
  private async requireUnifiedAccount(pid: bigint) {
    const user = await this.prisma.uaccount.findUnique({ where: { pid } });
    if (!user) {
      throw new ForbiddenException(
        'A unified account is required to request an organization',
      );
    }
    if (!user.mobile && !user.email) {
      throw new ForbiddenException(
        'Please add a mobile number or email to your account before requesting an organization — ' +
          'it is how you will be contacted about the request.',
      );
    }
    return user;
  }

  /**
   * approve()'s defense-in-depth admin check — see the comment at its call
   * site for why this is worth the extra query despite SiteAdminGuard
   * already having run.
   */
  private async requireActiveSiteAdmin(adminId: string) {
    const admin = await this.prisma.site_admins.findUnique({
      where: { admin_id: adminId },
    });
    if (!admin || !admin.is_active) {
      throw new ForbiddenException(
        'This admin account is not active. Please sign in again.',
      );
    }
  }

  private isOpenStatus(status: string): status is 'PENDING' | 'NEEDS_INFO' {
    return (OPEN_ORG_REQUEST_STATUSES as readonly string[]).includes(status);
  }

  /**
   * Validates+normalises list()'s optional status filter. Empty/omitted
   * defaults to the open statuses (see list()'s own doc comment for why);
   * an explicit filter is upper-cased and checked against the full status
   * set (not just the open ones — history browsing needs
   * APPROVED/REJECTED too), so a typo'd status produces a clear
   * BadRequestException instead of a silently-empty result page.
   */
  private resolveStatusFilter(status?: string[]): OrgRequestStatus[] {
    if (!status || status.length === 0) {
      return [...OPEN_ORG_REQUEST_STATUSES];
    }
    const normalized = status.map((s) => s.trim().toUpperCase());
    for (const s of normalized) {
      if (!(ALL_ORG_REQUEST_STATUSES as readonly string[]).includes(s)) {
        throw new BadRequestException(
          `Invalid status "${s}". Expected one of: ${ALL_ORG_REQUEST_STATUSES.join(', ')}.`,
        );
      }
    }
    return normalized as OrgRequestStatus[];
  }

  /**
   * Splits a ReviewOrgRequestDto into the two differently-audienced strings
   * reject()/requestInfo() need to write: the requester-facing review_note
   * and the internal admin_audit_log.reason. See review-org-request.dto.ts
   * for why these are allowed to be the same text (internal_note omitted)
   * or deliberately different (internal_note given).
   *
   * class-validator's @IsNotEmpty() only rejects the empty string, not a
   * whitespace-only one — trimmed here and re-checked, same defensive shape
   * as submit()'s orgName.length check, so " " can't sneak past validation
   * and land as a blank review_note.
   */
  private resolveReviewNotes(dto: ReviewOrgRequestDto): {
    reviewNote: string;
    internalReason: string;
  } {
    const reviewNote = dto.reason.trim();
    if (reviewNote.length === 0) {
      throw new BadRequestException(
        'A reason is required — it will be shown to the requester.',
      );
    }
    const internalReason = dto.internal_note?.trim() || reviewNote;
    return { reviewNote, internalReason };
  }

  /**
   * Case-insensitive lookup of this account's open request for a given name.
   * Matches the shape of the unique_open_org_request partial index
   * (pid, lower(btrim(org_name))) WHERE status IN ('PENDING','NEEDS_INFO').
   */
  private async findOpenRequestByName(pid: bigint, orgName: string) {
    return this.prisma.org_requests.findFirst({
      where: {
        pid,
        org_name: { equals: orgName, mode: 'insensitive' },
        status: { in: [...OPEN_ORG_REQUEST_STATUSES] },
      },
      select: { reference_code: true, org_name: true, status: true },
    });
  }

  /**
   * submit()'s cooldown check (subphase 4.4) — the single most recent
   * org_requests row for this pid, regardless of name or status. Matches
   * idx_org_requests_pid's (pid, created_at DESC) shape exactly, so this is
   * an index-only lookup, not a scan.
   */
  private async findMostRecentRequest(pid: bigint) {
    return this.prisma.org_requests.findFirst({
      where: { pid },
      orderBy: { created_at: 'desc' },
      select: { created_at: true, reference_code: true },
    });
  }

  /**
   * submit()'s fuzzy name-match signal (subphase 4.2). Raw SQL rather than
   * a Prisma filter because there is no Prisma-level equivalent of
   * pg_trgm's similarity() — same reasoning as voting.service.ts's own
   * $queryRaw calls for get_scope_descendants()/get_scope_ancestors(),
   * which reach for a DB function Prisma has no query-builder shape for.
   *
   * Compares against every non-deleted organization regardless of status
   * (ACTIVE/SUSPENDED/ARCHIVED): a name colliding with an archived org is
   * just as worth a reviewer's attention as one colliding with an active
   * one. Returns null (not a zero-score row) when nothing clears
   * NAME_SIMILARITY_THRESHOLD — see that constant's own comment for why a
   * low score isn't a meaningful signal to store at all.
   */
  private async findClosestOrgNameMatch(
    orgName: string,
  ): Promise<{ org_name: string; score: number } | null> {
    const rows = await this.prisma.$queryRaw<
      { org_name: string; score: number }[]
    >`
      SELECT org_name, similarity(lower(org_name), lower(${orgName})) AS score
      FROM organization
      WHERE is_deleted = false
      ORDER BY score DESC
      LIMIT 1
    `;
    const best = rows[0];
    if (!best || best.score < NAME_SIMILARITY_THRESHOLD) {
      return null;
    }
    return best;
  }

  /**
   * submit()'s free-email-domain signal (subphase 4.2). Returns false for a
   * missing/malformed email — there's nothing to flag, and submit() already
   * validates org_email's shape via SubmitOrgRequestDto's @IsEmail() before
   * this is ever called.
   */
  private isFreeEmailDomain(email: string | null): boolean {
    if (!email) return false;
    const domain = email.split('@')[1]?.toLowerCase();
    return !!domain && FREE_EMAIL_DOMAINS.has(domain);
  }

  /**
   * Narrow a Prisma unique violation to the open-request index specifically,
   * so an unrelated unique collision (a future column, or the
   * approved_orgid UNIQUE) isn't misreported as a duplicate submission.
   * Same approach as isOrgIdUniqueConflict() in orgid.utilities.ts.
   */
  private isOpenRequestConflict(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (err.code !== 'P2002') return false;
    const target = err.meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(',')
      : String(target ?? '');
    return targetStr.includes('unique_open_org_request');
  }
}
