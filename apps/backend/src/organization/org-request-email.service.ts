import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

// ─── Org request transactional emails  ───────
//
// The four notifications an org_requests row's lifecycle produces: the
// requester hears back at submission, and again at whichever of the three
// review outcomes (approve/reject/needs-info) a site admin picks. Reuses
// otp-delivery.service.ts's own SendGrid pattern deliberately — same
// `sgMail.send()` call shape, same styled-card HTML wrapper, same
// `SENDGRID_API_KEY`/`SENDGRID_SENDER_EMAIL` env vars — rather than
// inventing a second way to send an email in this codebase.
//
// Deliberately its own file/service, not folded into OtpDeliveryService:
// that service is specifically OTP delivery (email OR WhatsApp, keyed by
// identifier format, purpose-scoped against otp_verification) — these four
// messages are plain one-way notifications with no code to verify and no
// WhatsApp equivalent (org_requests has no notion of a mobile-channel
// notification; email is the only contact method a request review speaks
// to). Giving them their own service keeps OtpDeliveryService's own surface
// (send/sendEmail/sendWhatsApp, all OTP-purpose-scoped) from growing a
// second, unrelated purpose.
//
// Deliberately swallows its own failures (logs, never throws) — unlike
// OtpDeliveryService.sendEmail(), which rethrows because the *point* of
// that call is handing the user a code they need right now. By the time
// any method here is called, the underlying action (submit/approve/reject/
// requestInfo) has already succeeded and its own transaction has already
// committed — a SendGrid outage should not turn a successful review
// decision into a 500 for the admin who just made it, or make submit()
// fail after the org_requests row already exists. The requester not
// getting an email is a real gap (nothing here retries), but it is a
// strictly smaller problem than the action itself failing or double-firing
// on a retry.
@Injectable()
export class OrgRequestEmailService {
  private readonly logger = new Logger(OrgRequestEmailService.name);

  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  }

  /**
   * PENDING — sent once, right after submit() creates the row. Echoes the
   * same reference code/wording submit()'s own return message already
   * gives the requester synchronously, so the two don't drift.
   */
  async sendRequestReceived(
    to: string | null,
    referenceCode: string,
    orgName: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `Request received — ${referenceCode}`,
      `
        <p>We've received your request to create <strong>${escapeHtml(orgName)}</strong>.</p>
        <p>Your tracking reference is <strong>${referenceCode}</strong>. A site admin will
        review it and you'll hear back here once a decision is made.</p>
      `,
    );
  }

  /**
   * NEEDS_INFO — sent from requestInfo(). Surfaces review_note (the
   * requester-facing text an admin wrote) directly — this is the one
   * message of the four where the requester is expected to act (edit and
   * resubmit via the "My requests" view), so the question itself has to
   * be in the email, not just a status change notice.
   */
  async sendNeedsInfo(
    to: string | null,
    referenceCode: string,
    orgName: string,
    reviewNote: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `More information needed — ${referenceCode}`,
      `
        <p>Your request for <strong>${escapeHtml(orgName)}</strong>
        (${referenceCode}) needs more information before it can be approved:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #1d4ed8;
                            background:#f8fafc;color:#334155;">
          ${escapeHtml(reviewNote)}
        </blockquote>
        <p>Sign in and open your request to respond.</p>
      `,
    );
  }

  /**
   * APPROVED — sent from finalizeSetup(), after the organization row
   * (and the requester's own OWNER membership in it) already exist.
   * Includes the orgid since that's the first time it exists to tell them.
   *
   * Not sent from approve() — see sendApprovedPendingSetup() below, which
   * fires at that point in the flow instead, because no orgid exists yet to
   * report.
   */
  async sendApproved(
    to: string | null,
    referenceCode: string,
    orgName: string,
    orgid: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `Request approved — ${orgName} is live`,
      `
        <p>Good news — your request for <strong>${escapeHtml(orgName)}</strong>
        (${referenceCode}) has been approved.</p>
        <p>Your organization ID is <strong>${orgid}</strong>. You've been added as its
        first organizer — sign in to get started.</p>
      `,
    );
  }

  /**
   * APPROVED_PENDING_SETUP — Sent from approve(). A site admin
   * signing off does not mean the organization exists yet — it just means
   * the requester can now finish setup (choosing an orgid, confirming
   * the org contact email, and supplying their own uid). Unlike
   * sendApproved() there is no orgid or member role to report yet, so this
   * is a call-to-action email rather than a "you're in" one — the
   * substantive one lands once finalizeSetup() actually creates the org.
   */
  async sendApprovedPendingSetup(
    to: string | null,
    referenceCode: string,
    orgName: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `Request approved — action needed for ${orgName}`,
      `
        <p>Good news — your request for <strong>${escapeHtml(orgName)}</strong>
        (${referenceCode}) has been approved.</p>
        <p>One step remains before the organization is created: sign in and complete
        setup — choose your organization ID, confirm your organization's contact
        email, and pick your own member ID. Nothing is created until you do.</p>
      `,
    );
  }

  /**
   * REJECTED — sent from reject(). Same review_note-surfacing reasoning as
   * sendNeedsInfo(), except this outcome is terminal: no "respond" call to
   * action, since REJECTED requests can't be edited-and-resubmitted (a
   * fresh submit() is what a requester would do next, subject to the same
   * checks as any other).
   */
  async sendRejected(
    to: string | null,
    referenceCode: string,
    orgName: string,
    reviewNote: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `Request not approved — ${referenceCode}`,
      `
        <p>Your request for <strong>${escapeHtml(orgName)}</strong>
        (${referenceCode}) was not approved:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #dc2626;
                            background:#fef2f2;color:#334155;">
          ${escapeHtml(reviewNote)}
        </blockquote>
      `,
    );
  }

  /**
   * APPROVED_PENDING_SETUP -> REJECTED — Sent from revokeApproval(), the admin action for
   * a request that was approved but never finalized (see
   * OrgRequestsService.revokeApproval() and its own comment on why revoking is a
   * manual action with no auto-expiry). Distinct wording
   * from sendRejected() — this requester DID get approved and is losing an
   * approval they already had, not being turned down on first review — but
   * it lands in the same terminal REJECTED status, so the requester's next
   * step (submit a fresh request) is identical.
   */
  async sendApprovalRevoked(
    to: string | null,
    referenceCode: string,
    orgName: string,
    reviewNote: string,
  ): Promise<void> {
    await this.dispatch(
      to,
      referenceCode,
      `Approval revoked — ${referenceCode}`,
      `
        <p>Your request for <strong>${escapeHtml(orgName)}</strong>
        (${referenceCode}) was previously approved, but that approval has
        since been revoked because setup was never completed:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #dc2626;
                            background:#fef2f2;color:#334155;">
          ${escapeHtml(reviewNote)}
        </blockquote>
        <p>You're welcome to submit a new request if you'd still like to create
        this organization.</p>
      `,
    );
  }

  // ─── Shared send path ────────────────────────────────────────────────────
  /**
   * `to === null` means the requester has no email on file (accounts only
   * require *a* contact — see IdentityService.requireUnifiedAccount() /
   * OrgRequestsService's own copy — mobile alone qualifies). There is no
   * WhatsApp equivalent for these messages (see the file header comment),
   * so this is a deliberate, logged no-op rather than an error: the
   * underlying org-request action has already succeeded either way, and a
   * requester who only gave a mobile number simply won't get this specific
   * notification — the "My requests" view is where they'd see the same
   * status without needing email at all.
   */
  private async dispatch(
    to: string | null,
    referenceCode: string,
    subject: string,
    bodyHtml: string,
  ): Promise<void> {
    if (!to) {
      this.logger.log(
        `No email on file for request ${referenceCode} — skipping notification.`,
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
              This is an automated message about your organization request.
            </p>
          </div>
        `,
      });
      this.logger.log(`Org request email sent → ${to} (${subject})`);
    } catch (err) {
      // Swallowed deliberately — see this class's own header comment.
      this.logger.error(
        `Failed to send org request email to ${to} (${subject})`,
        err,
      );
    }
  }
}

/**
 * org_name and review_note are both free text the requester/admin typed —
 * unlike the OTP email (a fixed template with only a numeric code
 * interpolated), these messages embed that text directly into the HTML
 * body, so it needs escaping. otp-delivery.service.ts never needed this
 * (nothing it interpolates is user-authored HTML-unsafe text).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
