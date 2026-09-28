import { IsEmail, IsNotEmpty } from 'class-validator';

// ─── Send Org Domain OTP DTO ──────────────────────────────────────────────────
// Input for
// OrgRequestsService.sendDomainOtp() / POST /org/request/send-domain-otp.
//
// Deliberately its own DTO rather than reusing auth's SendOtpDto: that one
// takes a bare `identifier` (mobile or email) for a LOGIN-purpose OTP.
// This one is always an email (org_email is validated as one everywhere
// else it appears — see SubmitOrgRequestDto), and the field name matches
// SubmitOrgRequestDto's own `org_email` so the two DTOs read as a pair: send
// the code to this address, then submit with that same address plus the
// code you received.
export class SendOrgDomainOtpDto {
  @IsEmail()
  @IsNotEmpty()
  org_email: string;
}
