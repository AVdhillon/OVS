import {
  Controller,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { AddCandidateDto } from './dto/add-candidate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
// Replaced @Req() + req.user cast with @CurrentUser() throughout
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('events/:eventId/candidates')
export class CandidatesController {
  constructor(private candidatesService: CandidatesService) {}

  /** POST /events/:eventId/candidates — add a candidate before event starts */
  @Post()
  addCandidate(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: AddCandidateDto,
  ) {
    return this.candidatesService.addCandidate(user, eventId, dto);
  }

  /** DELETE /events/:eventId/candidates/:candidateId */
  @Delete(':candidateId')
  removeCandidate(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('candidateId', ParseIntPipe) candidateId: number,
  ) {
    return this.candidatesService.removeCandidate(user, eventId, candidateId);
  }

  /** PATCH /events/:eventId/candidates/:candidateId */
  @Patch(':candidateId')
  updateCandidate(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('candidateId', ParseIntPipe) candidateId: number,
    @Body() dto: AddCandidateDto,
  ) {
    return this.candidatesService.updateCandidate(
      user,
      eventId,
      candidateId,
      dto,
    );
  }
}
