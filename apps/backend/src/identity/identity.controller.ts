import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type JwtUser,
} from 'src/common/decorators/current-user.decorator';
import { IdentityService } from './identity.service';
import { AddIdentityDto } from './dto/add-identity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('identity')
export class IdentityController {
  constructor(private identityService: IdentityService) {}

  // GET /identity/getwallet
  // Returns all identities bound to the caller's pid.
  @Get('getwallet')
  getWallet(@CurrentUser() user: JwtUser) {
    return this.identityService.getWallet(BigInt(user.pid!));
  }

  // POST /identity/wallet/add
  // EDIT (Phase 1 — auth model consolidation, subphase 1.4): stale comment
  // updated — only ORG identities can be linked now (GOV retired platform-
  // wide; see AddIdentityDto/identity.service.ts). No behavior change.
  // Links a new ORG identity to the caller's unified account.
  // Requires a valid OTP sent to the contact on file for that identity.
  @Post('wallet/add')
  addIdentity(@CurrentUser() user: JwtUser, @Body() dto: AddIdentityDto) {
    return this.identityService.addIdentity(BigInt(user.pid!), dto);
  }
}
