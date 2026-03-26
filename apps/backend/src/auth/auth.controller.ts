import { Controller, Post, Body, Req,Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.identifier);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.identifier, dto.otp);
  }

  @Post('login')
login(@Body() dto: LoginDto, @Req() req: any) {
  return this.authService.login(dto, req);
}

@Post('logout')
@UseGuards(AuthGuard('jwt')) // ✅ only logged-in users can logout
logout(@Req() req: express.Request) {
  const token = req.headers.authorization?.split(' ')[1];
  return this.authService.logout(token!);
}
@UseGuards(AuthGuard('jwt'))
@Get('profile')
getProfile(@Req() req: express.Request) {
  //console.log(req.headers);
  return req.user;
}
}