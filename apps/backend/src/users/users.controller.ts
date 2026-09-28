import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  CurrentUser,
  type JwtUser,
} from 'src/common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // POST /users/register  — public, no JWT required
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.usersService.register(dto);
  }

  // GET /users/me
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: JwtUser) {
    return this.usersService.getProfile(BigInt(user.pid!));
  }

  // PATCH /users/me
  // Was using @Req() + manual (req.user as any).pid cast;
  //      now uses @CurrentUser() consistently, same as getProfile above.
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: JwtUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(BigInt(user.pid!), dto);
  }
}
