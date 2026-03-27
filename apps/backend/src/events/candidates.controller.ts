import {
  Controller,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { AddCandidateDto } from './dto/add-candidate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Request } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('events/:eventId/candidates')
export class CandidatesController {
  constructor(private candidatesService: CandidatesService) {}

  /** POST /events/:eventId/candidates — add a candidate before event starts */
  @Post()
  addCandidate(
    @Req() req: Express.Request,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: AddCandidateDto,
  ) {
    return this.candidatesService.addCandidate(req.user as any, eventId, dto);
  }

  /** DELETE /events/:eventId/candidates/:candidateId */
  @Delete(':candidateId')
  removeCandidate(
    @Req() req: Express.Request,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('candidateId', ParseIntPipe) candidateId: number,
  ) {
    return this.candidatesService.removeCandidate(req.user as any, eventId, candidateId);
  }

  /** PATCH /events/:eventId/candidates/:candidateId */
  @Patch(':candidateId')
  updateCandidate(
    @Req() req: Express.Request,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('candidateId', ParseIntPipe) candidateId: number,
    @Body() dto: AddCandidateDto,
  ) {
    return this.candidatesService.updateCandidate(req.user as any, eventId, candidateId, dto);
  }
}
