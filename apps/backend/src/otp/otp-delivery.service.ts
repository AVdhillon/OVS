import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import twilio from 'twilio'; //-for whatsapp message

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  // ─── Nodemailer transporter (Gmail SMTP) ────────────────────────────────
  /*private readonly mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,       // your.address@gmail.com
      pass: process.env.GMAIL_APP_PASS,   // 16-char App Password from Google Account > Security
    },
  });*/
  private readonly mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // use STARTTLS
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASS,
    },
  });

  // ─── Twilio client ──────────────────────────────────────────────────────
  private readonly twilio = twilio(  //-for whatsappmessage
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  /**
   * Dispatch OTP to the right channel based on the identifier format.
   * Email → Nodemailer SMTP
   * Mobile (10-digit) → Twilio WhatsApp Sandbox
   */
  async send(identifier: string, otp: string): Promise<void> {
    const isEmail = identifier.includes('@');

    if (isEmail) {
      await this.sendEmail(identifier, otp);
    } else {
      await this.sendWhatsApp(identifier, otp);
      //await this.sendSms(identifier, otp); //--uses fast2sms quicksms need rs100
    }
  }

  // ─── Email via Gmail SMTP ───────────────────────────────────────────────
  private async sendEmail(to: string, otp: string): Promise<void> {
    try {
      await this.mailer.sendMail({
        from: `"Online Voting Platform" <${process.env.GMAIL_USER}>`,
        to,
        subject: 'Your OTP Code',
        text: `Your OTP is: ${otp}\n\nIt expires in 5 minutes. Do not share it with anyone.`,
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
            <h2 style="color:#1d4ed8;margin-bottom:8px;">Online Voting Platform</h2>
            <p style="color:#374151;">Your one-time password:</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;padding:16px 0;">
              ${otp}
            </div>
            <p style="color:#6b7280;font-size:14px;">Expires in <strong>5 minutes</strong>. Do not share this code.</p>
          </div>
        `,
      });
      this.logger.log(`OTP email sent → ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${to}`, err);
      throw err;
    }
  }

  // ─── WhatsApp via Twilio Sandbox ────────────────────────────────────────
  // Setup: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
  // User must send "join <sandbox-keyword>" to +14155238886 once to opt in.
  private async sendWhatsApp(mobile: string, otp: string): Promise<void> {
    // Normalise to E.164 — assumes India (+91) by default.
    // Change the country prefix via TWILIO_COUNTRY_CODE env var.
    const countryCode = process.env.TWILIO_COUNTRY_CODE ?? '+91';
    const to = `whatsapp:${countryCode}${mobile}`;
    const from = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM ?? '+14155238886'}`; // sandbox number

    try {
      await this.twilio.messages.create({
        from,
        to,
        body: `Your OTP for Online Voting Platform is: *${otp}*\n\nExpires in 5 minutes. Do not share this code.`,
      });
      this.logger.log(`OTP WhatsApp sent → ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send OTP WhatsApp to ${to}`, err);
      throw err;
    }
  }
  // Remove twilio import and client entirely if using sms
  private async sendSms(mobile: string, otp: string): Promise<void> {  //using twilio only sms myself
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV] OTP for ${mobile}: ${otp}`);
      return;
    }
  
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
  
    await client.messages.create({
      from: process.env.TWILIO_PHONE_FROM,
      to: `+91${mobile}`,
      body: `Your OTP for Online Voting Platform is: ${otp}. Expires in 5 minutes.`,
    });
  }/*
private async sendSms(mobile: string, otp: string): Promise<void> {   //fastsms
  const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: process.env.FAST2SMS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      route: 'q',
      variables_values: otp,
      numbers: mobile,   // plain 10-digit, no +91
    }),
  });

  const result = await response.json();

  if (!result.return) {
    this.logger.error(`Fast2SMS failed`, result);
    throw new Error(`SMS delivery failed: ${JSON.stringify(result)}`);
  }

  this.logger.log(`OTP SMS sent → ${mobile}`);
}*/
}
