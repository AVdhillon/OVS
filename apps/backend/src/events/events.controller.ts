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
  // Scope hierarchy check happens inside the DB trigger
  // (trg_check_event_creator), not at the guard layer.
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
  // This route only has :eventId — no orgid
  // in the route or body — so RolesGuard's orgid resolution
  // (`user?.orgid ?? req.params?.orgid ?? req.body?.orgid`) could only ever
  // succeed for ORG sessions (whose JWT carries orgid). For UNIFIED
  // sessions user.orgid is undefined, so the guard threw "org context
  // required" and blocked every legitimate UNIFIED-organizer delete before
  // the request ever reached the service — the same class of bug already
  // fixed for getParticipants. The service's deleteEvent() already loads
  // the event and calls assertCallerOwnsEvent(), which does full
  // org-identity resolution and a stricter creator-only check
  // than this guard ever performed, so the guard is redundant here and
  // removed rather than patched to guess an orgid it can't know yet.
  @Delete(':eventId')
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
  // Organizer-only — only org organizers should see full participant + voted status.
  // This route has no orgid param (only :eventId), so
  // RolesGuard/@RequireOrganizer('orgid') could never resolve an orgid for
  // UNIFIED sessions (user.orgid is undefined on UNIFIED, and there's no
  // route/body orgid to fall back to) — it would 403 before the service
  // ever ran. The event's orgid isn't known until it's loaded, so full
  // organizer-identity resolution now happens inside
  // EventsService.getParticipants() itself, after the event lookup
  // (same org-identity resolution pattern as updateEvent/deleteEvent).
  @Get(':eventId/participants')
  getParticipants(
    @CurrentUser() user: JwtUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.getParticipants(user, eventId);
  }
}
