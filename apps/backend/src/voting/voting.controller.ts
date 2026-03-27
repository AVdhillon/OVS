import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { VotingService } from './voting.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('voting')
export class VotingController {
  constructor(private votingService: VotingService) {}

  /**
   * POST /voting/cast
   * Cast a vote for a candidate in an event.
   * Caller must be an active participant for that event.
   *
   * No RolesGuard here — voter eligibility (is_voter role + scope + participant
   * check) is enforced by the DB triggers and VotingService, not at route level.
   */
  @Post('cast')
  castVote(
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
    @Body() dto: CastVoteDto,
  ) {
    return this.votingService.castVote(user, dto, req);
  }
}