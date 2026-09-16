import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import twilio from 'twilio';

// EDIT (Phase 4 — cutover, subphase 4.3): every OTP this service has ever
// sent was implicitly a login/registration-adjacent "prove you control this
// identifier" message. `OtpPurpose` names that ('LOGIN', the default every
// existing caller keeps using) and adds the one new case this subphase
// needs: 'ORG_DOMAIN_OWNERSHIP', OrgRequestsService.submit()'s check that
// whoever supplied an org's contact email actually controls it. Defined
// here (not in otp.service.ts) so otp.service.ts can import it from this
// file without the two files importing from each other.
export type OtpPurpose = 'LOGIN' | 'ORG_DOMAIN_OWNERSHIP';

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  // ─── Twilio client (WhatsApp) ────────────────────────────────────────────
  private readonly twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  }

  /**
   * Dispatch OTP to the correct channel based on identifier format.
   *   Email (contains @) → SendGrid
   *   10-digit mobile    → Twilio WhatsApp sandbox
   *
   * EDIT (Phase 4 — cutover, subphase 4.3): `purpose` is passed through to
   * sendEmail() so the message can say what it's actually confirming — see
   * that method. WhatsApp delivery doesn't take it: 'ORG_DOMAIN_OWNERSHIP'
   * only ever targets org_email (SubmitOrgRequestDto validates it with
   * @IsEmail()), so the mobile channel never carries anything but a LOGIN
   * OTP in practice.
   */
  async send(
    identifier: string,
    otp: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<void> {
    if (identifier.includes('@')) {
      await this.sendEmail(identifier, otp, purpose);
    } else {
      await this.sendWhatsApp(identifier, otp);
    }
  }

  // ─── Email via SendGrid ──────────────────────────────────────────────────
  private async sendEmail(
    to: string,
    otp: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<void> {
    // EDIT (Phase 4 — cutover, subphase 4.3): purpose-specific copy so an
    // org-request submitter opening this email sees a message about
    // confirming their organization's email, not a generic "OTP Code" one
    // that reads like a login attempt they may not recognize.
    const { subject, intro } =
      purpose === 'ORG_DOMAIN_OWNERSHIP'
        ? {
            subject: 'Confirm your organization email — VoteCore',
            intro:
              "Enter this code to confirm you control this organization's " +
              'email address for your VoteCore organization request:',
          }
        : {
            subject: 'Your OTP Code',
            intro: 'Your one-time password:',
          };
    try {
      await sgMail.send({
        to,
        from: {
          email: process.env.SENDGRID_SENDER_EMAIL!,
          name: 'VoteCore',
        },
        subject,
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;
                      padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
            <h2 style="color:#1d4ed8;">VoteCore</h2>
            <p>${intro}</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0;">
              ${otp}
            </div>
            <p style="color:#6b7280;font-size:14px;">
              Expires in <strong>5 minutes</strong>. Do not share this code.
            </p>
          </div>
        `,
      });
      this.logger.log(`OTP email sent → ${to} (${purpose})`);
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${to}`, err);
      throw err;
    }
  }

  // ─── WhatsApp via Twilio Sandbox ─────────────────────────────────────────
  // One-time setup: user must send "join <sandbox-keyword>" to +14155238886.
  // See: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
  //
  // env vars:
  //   TWILIO_COUNTRY_CODE   — e.g. "+91"        (default: "+91")
  //   TWILIO_WHATSAPP_FROM  — sandbox number     (default: "+14155238886")
  private async sendWhatsApp(mobile: string, otp: string): Promise<void> {
    const countryCode = process.env.TWILIO_COUNTRY_CODE ?? '+91';
    const from = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM ?? '+14155238886'}`;
    const to = `whatsapp:${countryCode}${mobile}`;

    try {
      await this.twilioClient.messages.create({
        from,
        to,
        body:
          `Your OTP for VoteCore is: *${otp}*\n\n` +
          `Expires in 5 minutes. Do not share this code.`,
      });
      this.logger.log(`OTP WhatsApp sent → ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send OTP WhatsApp to ${to}`, err);
      throw err;
    }
  }
}
