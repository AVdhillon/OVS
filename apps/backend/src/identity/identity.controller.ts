import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from 'src/common/decorators/current-user.decorator';
import { IdentityService } from './identity.service';
import { AddIdentityDto } from './dto/add-identity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Request } from 'express';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
@UseGuards(JwtAuthGuard)
@Controller('identity')
export class IdentityController {
  constructor(private identityService: IdentityService) {}

  // GET /identity/wallet
  // Returns all identities bound to the caller's pid
  @Get('getwallet')
  getWallet(@CurrentUser() user: JwtUser){
    return this.identityService.getWallet(BigInt(user.pid!));
  }
  // POST /identity/wallet/add
  // Links a new GOV or ORG identity to the caller's unified account.
  // Requires a valid OTP to have been sent to the contact on that identity.
  @Post('wallet/add')
  addIdentity(@Req() req: Express.Request, @Body() dto: AddIdentityDto) {
    const pid = BigInt((req.user as any).pid);
    return this.identityService.addIdentity(pid, dto);
  }
}
