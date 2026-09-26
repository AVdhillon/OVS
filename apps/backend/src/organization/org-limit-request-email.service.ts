import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

// ─── Member-limit-request lifecycle emails (Phase 7 — Member Limit Increase
// Requests, subphase 7.5) ──────────────────────────────────────────────────
//
// The four notifications an org_member_limit_requests row's lifecycle
// produces: the requesting organizer hears back at submission, and again at
// whichever of the three review outcomes (approve/reject/needs-info) a site
// admin picks. Structurally this is a straight copy of
// org-request-email.service.ts's own shape (same `sgMail.send()` call, same
// styled-card HTML wrapper, same env vars, same swallow-and-log failure
// handling for the same reason: by the time any method here is called, the
// underlying submit()/approve()/reject()/requestInfo() call has already
// committed, so a SendGrid outage must not turn that into a failure for the
// caller who just made it).
//
// Deliberately its OWN file/service rather than new methods added to
// OrgRequestEmailService — the plan's own 7.5 text offers both options
// ("Extend org-request-email.service.ts's pattern (or a sibling service, if
// keeping the 'org that already exists' emails structurally separate is
// preferred)"), and this codebase has already answered that question for
// every other layer of these two request kinds: org-limit-requests.service.ts
// is its own class rather than new methods on OrgRequestsService, and
// org_member_limit_requests is its own table rather than new columns on
// org_requests — precisely because org_requests is about an org that
// doesn't exist yet, and org_member_limit_requests is about one that
// already does (different FK shape, different actor, different approval
// side effect — see org-limit-requests.service.ts's own header comment).
// The two email services should split the same way for the same reason,
// rather than becoming the one layer where the two request kinds are
// re-merged.
//
// No reference_code equivalent here: unlike org_requests,
// org_member_limit_requests (7.1, dbschema.sql) has no reference_code
// column — request_id (a bigint) is the only identifier the row carries, so
// that's what these messages surface instead.
@Injectable()
export class OrgLimitRequestEmailService {
  private readonly logger = new Logger(OrgLimitRequestEmailService.name);

  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  }

  /**
   * PENDING — sent once, right after submit() creates the row. Mirrors
   * OrgRequestEmailService.sendRequestReceived()'s "confirm what was just
   * submitted" role, but for this table there's no separate "wait for
   * review" framing needed beyond restating the numbers, since the request
   * itself already carries current_limit/requested_limit for the requester
   * to double-check against what they meant to submit.
   */
  async sendSubmitted(
    to: string | null,
    requestId: bigint,
    orgName: string,
    currentLimit: number,
    requestedLimit: number,
  ): Promise<void> {
    await this.dispatch(
      to,
      requestId,
      `Member limit request received — ${orgName}`,
      `
        <p>We've received your request to raise <strong>${escapeHtml(orgName)}</strong>'s
        member limit from <strong>${currentLimit}</strong> to
        <strong>${requestedLimit}</strong>.</p>
        <p>A site admin will review it and you'll hear back here once a decision is made.</p>
      `,
    );
  }

  /**
   * NEEDS_INFO — sent from requestInfo(). Same review_note-surfacing
   * reasoning as OrgRequestEmailService.sendNeedsInfo(): this is the one
   * outcome where the requester is expected to act, so the admin's question
   * has to be in the email itself, not just a status-change notice.
   */
  async sendNeedsInfo(
    to: string | null,
    requestId: bigint,
    orgName: string,
    reviewNote: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      requestId,
      `More information needed — ${orgName} member limit request`,
      `
        <p>Your request to raise <strong>${escapeHtml(orgName)}</strong>'s member
        limit needs more information before it can be approved:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #1d4ed8;
                            background:#f8fafc;color:#334155;">
          ${escapeHtml(reviewNote)}
        </blockquote>
        <p>Sign in and open the request from your organization dashboard to respond.</p>
      `,
    );
  }

  /**
   * APPROVED — sent from approve(), after organization.member_limit has
   * already been raised in the same transaction. Reports the new limit
   * directly, same "the first time this fact exists, tell them" reasoning
   * as OrgRequestEmailService.sendApproved() reporting the new orgid.
   */
  async sendApproved(
    to: string | null,
    requestId: bigint,
    orgName: string,
    newMemberLimit: number,
  ): Promise<void> {
    await this.dispatch(
      to,
      requestId,
      `Member limit request approved — ${orgName}`,
      `
        <p>Good news — your request to raise <strong>${escapeHtml(orgName)}</strong>'s
        member limit has been approved.</p>
        <p>The organization's member limit is now <strong>${newMemberLimit}</strong>.</p>
      `,
    );
  }

  /**
   * REJECTED — sent from reject(). Same review_note-surfacing, terminal-
   * outcome reasoning as OrgRequestEmailService.sendRejected(): no "respond"
   * call to action, since a fresh submit() (subject to the same one-open-
   * request-per-org guard) is what an organizer would do next.
   */
  async sendRejected(
    to: string | null,
    requestId: bigint,
    orgName: string,
    reviewNote: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      requestId,
      `Member limit request not approved — ${orgName}`,
      `
        <p>Your request to raise <strong>${escapeHtml(orgName)}</strong>'s member
        limit was not approved:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #dc2626;
                            background:#fef2f2;color:#334155;">
          ${escapeHtml(reviewNote)}
        </blockquote>
        <p>The organization's member limit is unchanged. You're welcome to submit a
        new request once the concern above has been addressed.</p>
      `,
    );
  }

  // ─── Shared send path ────────────────────────────────────────────────────
  /**
   * `to === null` means the requesting member has no email on file
   * (org_members.email is nullable — mobile alone qualifies for
   * membership, same as a unified account per
   * OrgRequestEmailService.dispatch()'s own comment). Deliberate, logged
   * no-op rather than an error: the underlying submit()/approve()/reject()/
   * requestInfo() action has already succeeded either way, and the org's
   * own "status of any open request" dashboard view (7.4) shows the same
   * status without needing email at all.
   */
  private async dispatch(
    to: string | null,
    requestId: bigint,
    subject: string,
    bodyHtml: string,
  ): Promise<void> {
    if (!to) {
      this.logger.log(
        `No email on file for member limit request ${requestId} — skipping notification.`,
      );
      return;
    }
    try {
      await sgMail.send({
        to,
        from: {
          email: process.env.SENDGRID_SENDER_EMAIL!,
          name: 'VoteCore',
        },
        subject,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;
                      padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
            <h2 style="color:#1d4ed8;">VoteCore</h2>
            ${bodyHtml}
            <p style="color:#6b7280;font-size:14px;margin-top:24px;">
              This is an automated message about your organization's member limit request.
            </p>
          </div>
        `,
      });
      this.logger.log(
        `Member limit request email sent → ${to} (${subject})`,
      );
    } catch (err) {
      // Swallowed deliberately — see this class's own header comment.
      this.logger.error(
        `Failed to send member limit request email to ${to} (${subject})`,
        err,
      );
    }
  }
}

/**
 * org_name and review_note are both free text (org_name at org-creation
 * time, review_note typed by an admin) — same escaping need/shape as
 * org-request-email.service.ts's own helper.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
