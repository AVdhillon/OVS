import { Controller, Post, Body, Req, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Generic OTP send — used during registration (UNIFIED account creation).
   * For login-time OTP dispatch, use POST /auth/send-login-otp instead,
   * which resolves the correct contact address from the identity record.
   */
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
  @Post('send-login-otp')
  sendLoginOtp(@Body() dto: LoginDto) {
    return this.authService.sendLoginOtp(dto);
  }

  /**
   * Standalone OTP verify — for two-step flows (e.g. registration confirm).
   * Login does its own atomic OTP verify; this endpoint is not needed there.
   */
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.identifier, dto.otp);
  }

  /**
   * Authenticate and obtain a JWT session token.
   * Includes OTP verification atomically — no prior /verify-otp call needed.
   */
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: express.Request) {
    return this.authService.login(dto, req);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  logout(@Req() req: express.Request) {
    const token = req.headers.authorization?.split(' ')[1];
    return this.authService.logout(token!);
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: express.Request) {
    return req.user;
  }
}
