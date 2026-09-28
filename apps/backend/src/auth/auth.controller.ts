import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto, SiteAdminLoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import { SiteAdminGuard } from './guards/site-admin.guard';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';

// Route-specific overrides of the global ThrottlerModule default (see
// app.module.ts), applied to the endpoints that actually gate access —
// OTP dispatch/verification and login. These are deliberately tighter than the app-wide default:
// each is keyed per-IP by ThrottlerGuard, so a single client can't hammer
// OTP generation/guessing or credential attempts past these caps even
// though otp_verification.attempts already locks a *given* OTP record —
// attempts resets whenever a fresh OTP is issued, so without this the
// per-record lockout can be sidestepped by just requesting new OTPs.
const OTP_SEND_THROTTLE = { default: { ttl: 60_000, limit: 3 } }; // 3/min/IP
const OTP_VERIFY_THROTTLE = { default: { ttl: 60_000, limit: 5 } }; // 5/min/IP
const LOGIN_THROTTLE = { default: { ttl: 60_000, limit: 5 } }; // 5/min/IP
// Admin login
// gets its own (tighter) throttle rather than reusing LOGIN_THROTTLE —
// the admin surface is smaller-population and higher-trust than regular
// login, so a lower cap costs legitimate admins little while meaningfully
// narrowing the brute-force window.
//
// Tightened from 3/min/IP to
// 5/15min/IP, a starting value that can be tuned per deployment.
// The two aren't directly comparable by "limit" alone — what matters is
// the sustained rate a per-minute window allows: 3/min/IP lets a
// sustained attacker make up to 180 attempts/hour by just staying under
// the per-minute cap indefinitely. A longer window with a smaller total
// (5 per 15 minutes = 20/hour at most) closes that off — it caps the
// *total* attempts over a much longer stretch, rather than resetting a
// small allowance every 60 seconds. Site-admin login volume is inherently
// low (this is not the regular-user LOGIN_THROTTLE surface), so this
// costs a legitimate admin nothing in practice — nobody mistypes an OTP
// five times in fifteen minutes under normal use.
const ADMIN_LOGIN_THROTTLE = { default: { ttl: 900_000, limit: 5 } }; // 5/15min/IP

// Cookie names + shared options for the auth cookie pair. Kept alongside
// the controller (rather than a config file) since jwt.strategy.ts is the
// only other reader and it only needs the name, not these options.
const TOKEN_COOKIE = 'ovp_token';
const CSRF_COOKIE = 'ovp_csrf';
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // keep in sync with auth.service.ts expires_at (1 hour)

// Admin session's
// own cookie pair, deliberately distinct names from TOKEN_COOKIE/
// CSRF_COOKIE above. site-admin-jwt.strategy.ts is the only other reader
// of ADMIN_TOKEN_COOKIE; csrf.guard.ts is the only other reader of
// ADMIN_CSRF_COOKIE. Using separate cookies (rather than overloading
// ovp_token with a `type` claim the frontend has to branch on) means a
// regular user session and an admin session can coexist in the same
// browser without either login clobbering the other's cookie, and means
// CsrfGuard/SiteAdminGuard don't have to disambiguate which "kind" of
// ovp_token a given cookie value represents.
const ADMIN_TOKEN_COOKIE = 'ovp_admin_token';
const ADMIN_CSRF_COOKIE = 'ovp_admin_csrf';

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
   * For ORG type, looks up the stored contact and sends OTP there — the
   * client does not supply the contact address directly.
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

    // The ovp_csrf cookie is set
    // as before for backends/frontends that DO share a registrable domain
    // (where document.cookie can read it directly). But when frontend and
    // backend live on unrelated hosts — e.g. two separate *.azurewebsites.net
    // apps — that's a public suffix, so the cookie can't even be scoped
    // broader via `domain`, and frontend JS can never read a cookie that
    // was set for a different origin. The browser still stores + resends it
    // automatically (SameSite=None; Secure), which is all CsrfGuard needs on
    // the way in — but the frontend needs the *value* to echo back as the
    // X-CSRF-Token header, and can no longer get it from document.cookie.
    // So we also hand it back directly in the login response body; the
    // frontend keeps it in memory/sessionStorage instead of reading the
    // cookie. See GET /auth/csrf-token below for how a page reload/new tab
    // rehydrates this without forcing a fresh login.
    const csrfToken = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false, // intentionally readable by JS — that's how double-submit works
      secure: isProd,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });

    return { message: 'Logged in', csrf_token: csrfToken };
  }

  /**
   * GET /auth/csrf-token
   * Rehydrates the CSRF token for a frontend that already has a valid
   * ovp_token session cookie but lost its in-memory/sessionStorage copy of
   * the CSRF value (e.g. a fresh tab, or a hard reload that cleared
   * sessionStorage in some browsers). Reads the ovp_csrf cookie straight
   * off the request — the browser already attaches it automatically even
   * though frontend JS can't read it directly (see login() above) — and
   * echoes it back in the response body. Requires a valid session, so this
   * can't be used to fish for a token without already being authenticated.
   */
  @Get('csrf-token')
  @UseGuards(AuthGuard('jwt'))
  getCsrfToken(@Req() req: express.Request) {
    const csrfToken = req.cookies?.[CSRF_COOKIE];
    if (!csrfToken) {
      throw new UnauthorizedException('No CSRF token for this session');
    }
    return { csrf_token: csrfToken };
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

  // ── Admin app routes ────────────────────────────────────────────────────
  // Mirror the UNIFIED/ORG routes above one-for-one, but drive
  // SiteAdminLoginDto/AuthService's SITEADMIN methods and set the separate
  // ovp_admin_token/ovp_admin_csrf cookie pair instead of ovp_token/
  // ovp_csrf — see the constants at the top of this file for why that
  // split exists. Kept on this same controller rather than a new one:
  // the underlying concerns (OTP dispatch, login, CSRF rehydration,
  // logout, profile) are identical in shape to the routes above, just
  // against a different identity table and cookie pair — splitting them
  // into a second controller would mean duplicating all of the
  // documentation above for no behavioral difference. The admin *app*
  // itself (a separate frontend build) is what's standalone
  // here, not this controller.

  /**
   * Admin login-aware OTP send. Accepts SiteAdminLoginDto minus otp.
   * Looks up the stored contact (site_admins.email/mobile) and sends the
   * OTP there — the client only ever supplies admin_id, never a contact
   * address directly.
   */
  @Throttle(OTP_SEND_THROTTLE)
  @Post('send-admin-login-otp')
  sendAdminLoginOtp(@Body() dto: SiteAdminLoginDto) {
    return this.authService.sendSiteAdminLoginOtp(dto);
  }

  /**
   * Authenticate as a site admin and obtain an admin session.
   * Same OTP-atomic-with-login shape as POST /auth/login, and the same
   * httpOnly-cookie + readable-CSRF-cookie pattern — just under the
   * ovp_admin_token/ovp_admin_csrf names instead.
   */
  @Throttle(ADMIN_LOGIN_THROTTLE)
  @Post('admin-login')
  async adminLogin(
    @Body() dto: SiteAdminLoginDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { access_token } = await this.authService.siteAdminLogin(dto, req);
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie(ADMIN_TOKEN_COOKIE, access_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });

    const csrfToken = randomBytes(32).toString('hex');
    res.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
      httpOnly: false, // intentionally readable by JS — see login() above
      secure: isProd,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });

    return { message: 'Logged in', csrf_token: csrfToken };
  }

  /**
   * GET /auth/admin-csrf-token
   * Admin-session counterpart to GET /auth/csrf-token above — same
   * rehydration purpose, reading the ovp_admin_csrf cookie instead.
   */
  @Get('admin-csrf-token')
  @UseGuards(SiteAdminGuard)
  getAdminCsrfToken(@Req() req: express.Request) {
    const csrfToken = req.cookies?.[ADMIN_CSRF_COOKIE];
    if (!csrfToken) {
      throw new UnauthorizedException('No CSRF token for this session');
    }
    return { csrf_token: csrfToken };
  }

  @Post('admin-logout')
  @UseGuards(SiteAdminGuard)
  adminLogout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token = req.cookies?.[ADMIN_TOKEN_COOKIE];
    res.clearCookie(ADMIN_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(ADMIN_CSRF_COOKIE, { path: '/' });
    return this.authService.logout(token!);
  }

  @Get('admin-profile')
  @UseGuards(SiteAdminGuard)
  getAdminProfile(@Req() req: express.Request) {
    return req.user;
  }
}
