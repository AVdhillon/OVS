import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/decorators/current-user.decorator';
import { RequireOrganizer } from '../common/decorators/require-organizer.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@UseGuards(JwtAuthGuard) // all routes require a valid session
@Controller('events')
export class EventsController {
  constructor(private eventsService: EventsService) {}

  // ── GET /events ────────────────────────────────────────────────────────────
  // No role check — any authenticated user sees their own visible events
  @Get()
  getMyEvents(@CurrentUser() user: JwtUser) {
    return this.eventsService.getVisibleEvents(user);
  }

  // ── GET /events/:eventId ───────────────────────────────────────────────────
  // No role check — visibility enforced inside the service
  @Get(':eventId')
  getEventDetail(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.getEventDetail(user, eventId);
  }

  // ── POST /events ───────────────────────────────────────────────────────────
  // Must be organizer in the org supplied in the body.
  // ScopeGuard is NOT applied here — scope check happens inside the DB trigger
  // (trg_check_event_creator) which already validates scope hierarchy.
  @Post()
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid') // reads orgid from body, uid from JWT or body
  createEvent(@CurrentUser() user: JwtUser, @Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(user, dto);
  }

  // ── PATCH /events/:eventId ─────────────────────────────────────────────────
  // Creator-only check is done inside the service (compares created_by_uid).
  // RolesGuard still ensures caller is at least an organizer.
  @Patch(':orgId/:eventId/:actingUid')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgId') // match the param name exactly
  updateEvent(
    @CurrentUser() user: JwtUser,
    //@Param('orgId', ParseIntPipe) orgId: string, // extract it
    @Param('eventId', ParseIntPipe) eventId: number,
    //@Param('actingUid', ParseIntPipe) actingUid: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.updateEvent(user, eventId, dto);
  }

  // ── DELETE /events/:eventId ────────────────────────────────────────────────
  @Delete(':eventId')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  deleteEvent(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.deleteEvent(user, eventId);
  }

  // ── GET /events/:eventId/results ───────────────────────────────────────────
  // No role guard — service checks show_live_results flag + completion status
  @Get(':eventId/results')
  getResults(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.getResults(user, eventId);
  }

  // ── GET /events/:eventId/participants ──────────────────────────────────────
  // Organizer-only — only org organizers should see full participant + voted status
  @Get(':eventId/participants')
  @UseGuards(RolesGuard)
  @RequireOrganizer('orgid')
  getParticipants(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.getParticipants(user, eventId);
  }
}
