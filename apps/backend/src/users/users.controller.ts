import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Request } from 'express';
import type { JwtUser } from 'src/common/decorators/current-user.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // POST /users/register  — public, no JWT required
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.usersService.register(dto);
  }

  // GET /users/me
  @Get('me')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user: JwtUser) {
  return this.usersService.getProfile(BigInt(user.pid!));
}

  // PATCH /users/me
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@Req() req: Express.Request, @Body() dto: UpdateUserDto) {
    const pid = BigInt((req.user as any).pid);
    return this.usersService.updateProfile(pid, dto);
  }
}
