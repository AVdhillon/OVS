import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';

// Route-specific overrides of the global ThrottlerModule default (see
// app.module.ts), applied to the endpoints that actually gate access —
// OTP dispatch/verification and login (fraud-heuristic-implementation-plan.md,
// Module A). These are deliberately tighter than the app-wide default:
// each is keyed per-IP by ThrottlerGuard, so a single client can't hammer
// OTP generation/guessing or credential attempts past these caps even
// though otp_verification.attempts already locks a *given* OTP record —
// attempts resets whenever a fresh OTP is issued, so without this the
// per-record lockout can be sidestepped by just requesting new OTPs.
const OTP_SEND_THROTTLE = { default: { ttl: 60_000, limit: 3 } }; // 3/min/IP
const OTP_VERIFY_THROTTLE = { default: { ttl: 60_000, limit: 5 } }; // 5/min/IP
const LOGIN_THROTTLE = { default: { ttl: 60_000, limit: 5 } }; // 5/min/IP

// Cookie names + shared options for the auth cookie pair. Kept alongside
// the controller (rather than a config file) since jwt.strategy.ts is the
// only other reader and it only needs the name, not these options.
const TOKEN_COOKIE = 'ovp_token';
const CSRF_COOKIE = 'ovp_csrf';
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // keep in sync with auth.service.ts expires_at (1 hour)

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Generic OTP send — used during registration (UNIFIED account creation).
   * For login-time OTP dispatch, use POST /auth/send-login-otp instead,
   * which resolves the correct contact address from the identity record.
   */
  @Throttle(OTP_SEND_THROTTLE)
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.identifier);
  }

  /**
   * Login-aware OTP send.
   * Accepts the same shape as LoginDto (minus the otp field).
   * For ORG/GOV types, looks up the stored contact and sends OTP there —
   * the client does not supply the contact address directly.
   */
  @Throttle(OTP_SEND_THROTTLE)
  @Post('send-login-otp')
  sendLoginOtp(@Body() dto: LoginDto) {
    return this.authService.sendLoginOtp(dto);
  }

  /**
   * Standalone OTP verify — for two-step flows (e.g. registration confirm).
   * Login does its own atomic OTP verify; this endpoint is not needed there.
   */
  @Throttle(OTP_VERIFY_THROTTLE)
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.identifier, dto.otp);
  }

  /**
   * Authenticate and obtain a session.
   * Includes OTP verification atomically — no prior /verify-otp call needed.
   *
   * The JWT is no longer returned in the response body — it's set as an
   * httpOnly cookie so client-side JS (and therefore XSS) can never read
   * it. A second, non-httpOnly `ovp_csrf` cookie is set alongside it for
   * double-submit CSRF protection on mutating requests (see CsrfGuard).
   */
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { access_token } = await this.authService.login(dto, req);
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie(TOKEN_COOKIE, access_token, {
      httpOnly: true,
      secure: isProd, // local HTTP dev needs this off; see plan doc's "Dev environment" note
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });

    res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), {
      httpOnly: false, // intentionally readable by JS — that's how double-submit works
      secure: isProd,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });

    return { message: 'Logged in' };
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token = req.cookies?.[TOKEN_COOKIE];
    res.clearCookie(TOKEN_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    return this.authService.logout(token!);
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: express.Request) {
    return req.user;
  }
}
