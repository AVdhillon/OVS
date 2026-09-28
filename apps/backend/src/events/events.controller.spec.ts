import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EventsController } from './events.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { ORGANIZER_KEY } from '../common/decorators/require-organizer.decorator';

describe('EventsController', () => {
  let controller: EventsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // DeleteEvent's route is `:eventId` only —
  // no orgid available in the route or body — so RolesGuard/@RequireOrganizer
  // could never resolve an orgid for UNIFIED sessions and would 403 every
  // legitimate UNIFIED-organizer delete before the service ever ran (same
  // class of bug fixed for getParticipants). Authorization for this
  // route now lives entirely in EventsService.deleteEvent() via
  // assertCallerOwnsEvent(), which does full org-identity resolution and a
  // creator-only check — stricter than RolesGuard's coarse organizer check.
  // This test locks in that RolesGuard/@RequireOrganizer stay off this route
  // so the regression doesn't silently come back.
  it('deleteEvent has no RolesGuard/@RequireOrganizer (service does the check)', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, controller.deleteEvent) ?? [];
    expect(guards).not.toContain(RolesGuard);

    const organizerMeta = Reflect.getMetadata(
      ORGANIZER_KEY,
      controller.deleteEvent,
    );
    expect(organizerMeta).toBeUndefined();
  });
});
