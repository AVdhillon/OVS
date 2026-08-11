import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgService } from '../organization/org.service';
import type { JwtUser } from '../common/decorators/current-user.decorator';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    events: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
    member_roles: { findFirst: jest.Mock };
    org_scope: { findFirst: jest.Mock };
    candidates: { createMany: jest.Mock; findMany: jest.Mock };
    vote_results: { createMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let orgService: { resolveCallerUid: jest.Mock };

  // Event belongs to org "ORG_B", created/organized by uid "U_B1".
  const orgBEvent = {
    event_id: 1,
    orgid: 'ORG_B',
    created_by_uid: 'U_B1',
    start_time: new Date(Date.now() + 60 * 60 * 1000), // future — not started
  };

  const unifiedOrgAUser: JwtUser = {
    type: 'UNIFIED',
    pid: 42,
    session_id: 's1',
  };

  const unifiedOrgBUser: JwtUser = {
    type: 'UNIFIED',
    pid: 99,
    session_id: 's2',
  };

  const orgSessionOrgAUser: JwtUser = {
    type: 'ORG',
    orgid: 'ORG_A',
    uid: 'U_A1',
    session_id: 's3',
  };

  const orgSessionOrgBUser: JwtUser = {
    type: 'ORG',
    orgid: 'ORG_B',
    uid: 'U_B1',
    session_id: 's4',
  };

  beforeEach(async () => {
    prisma = {
      events: {
        findFirst: jest.fn().mockResolvedValue(orgBEvent),
        update: jest.fn().mockResolvedValue({ ...orgBEvent }),
        create: jest.fn().mockResolvedValue({ ...orgBEvent, event_id: 2 }),
      },
      member_roles: { findFirst: jest.fn() },
      org_scope: { findFirst: jest.fn() },
      candidates: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { candidate_id: 1, event_id: 2 },
          { candidate_id: 2, event_id: 2 },
        ]),
      },
      vote_results: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ scope_id: 1 }]),
    };
    orgService = { resolveCallerUid: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrgService, useValue: orgService },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cross-org IDOR fix (Phase 2a)', () => {
    it('rejects UNIFIED organizer of org A updating an org B event', async () => {
      // Caller's pid only links to org A -> resolveCallerUid would resolve
      // to their org-A uid, which never matches org B's created_by_uid.
      orgService.resolveCallerUid.mockResolvedValue('U_A1');

      await expect(
        service.updateEvent(unifiedOrgAUser, 1, { title: 'hacked' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects UNIFIED organizer of org A deleting an org B event', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_A1');

      await expect(service.deleteEvent(unifiedOrgAUser, 1)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows UNIFIED organizer updating their own org (org B) event', async () => {
      // Caller's pid links to org B as uid U_B1, matching created_by_uid.
      orgService.resolveCallerUid.mockResolvedValue('U_B1');

      const result = await service.updateEvent(unifiedOrgBUser, 1, {
        title: 'legit update',
      } as any);

      expect(result).toBeDefined();
      expect(orgService.resolveCallerUid).toHaveBeenCalledWith(
        unifiedOrgBUser,
        'ORG_B',
      );
    });

    it('allows UNIFIED organizer deleting their own org (org B) event', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');

      const result = await service.deleteEvent(unifiedOrgBUser, 1);

      expect(result).toEqual({ message: 'Event cancelled and removed' });
    });

    it('rejects ORG-session organizer of org A targeting an org B event without calling resolveCallerUid', async () => {
      await expect(
        service.updateEvent(orgSessionOrgAUser, 1, { title: 'x' } as any),
      ).rejects.toThrow(ForbiddenException);

      // Should short-circuit on the orgid mismatch before ever resolving uid.
      expect(orgService.resolveCallerUid).not.toHaveBeenCalled();
    });

    it('allows ORG-session organizer acting within their own org (regression)', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');

      const result = await service.updateEvent(orgSessionOrgBUser, 1, {
        title: 'own org update',
      } as any);

      expect(result).toBeDefined();
    });
  });

  describe('getParticipants (Phase 2b)', () => {
    it('rejects UNIFIED organizer of org A viewing participants for an org B event (not a member of org B at all)', async () => {
      // Mirrors OrgService.resolveCallerUid's real behavior: a pid with no
      // org_members link to ORG_B throws Forbidden before any uid is resolved.
      orgService.resolveCallerUid.mockRejectedValue(
        new ForbiddenException('You are not a member of this organization'),
      );

      await expect(
        service.getParticipants(unifiedOrgAUser, 1),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.member_roles.findFirst).not.toHaveBeenCalled();
    });

    it('rejects UNIFIED member of org B who is not an organizer there', async () => {
      // Caller resolves to a real org-B uid, but that uid has no
      // is_organizer role row -> member_roles lookup returns null.
      orgService.resolveCallerUid.mockResolvedValue('U_B_VOTER');
      prisma.member_roles.findFirst.mockResolvedValue(null);

      await expect(
        service.getParticipants(unifiedOrgBUser, 1),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows UNIFIED organizer of org B viewing participants for their own org B event', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');
      prisma.member_roles.findFirst.mockResolvedValue({
        orgid: 'ORG_B',
        uid: 'U_B1',
        is_organizer: true,
        scope_id: 5,
      });
      prisma.$queryRaw.mockResolvedValue([
        { uid: 'U_B2', orgid: 'ORG_B', has_voted: true },
      ]);

      const result = await service.getParticipants(unifiedOrgBUser, 1);

      expect(result).toEqual({
        event_id: 1,
        participants: [{ uid: 'U_B2', orgid: 'ORG_B', has_voted: true }],
      });
      expect(orgService.resolveCallerUid).toHaveBeenCalledWith(
        unifiedOrgBUser,
        'ORG_B',
      );
    });

    it('rejects ORG-session organizer of org A viewing participants for an org B event (regression, no membership resolution attempted)', async () => {
      await expect(
        service.getParticipants(orgSessionOrgAUser, 1),
      ).rejects.toThrow(ForbiddenException);

      expect(orgService.resolveCallerUid).not.toHaveBeenCalled();
    });

    it('allows ORG-session organizer viewing participants for their own org (regression)', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');
      prisma.member_roles.findFirst.mockResolvedValue({
        orgid: 'ORG_B',
        uid: 'U_B1',
        is_organizer: true,
        scope_id: 5,
      });
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getParticipants(orgSessionOrgBUser, 1);

      expect(result).toEqual({ event_id: 1, participants: [] });
    });
  });

  describe('createEvent (Phase 2b)', () => {
    const baseDto = {
      orgid: 'ORG_B',
      uid: 'U_B1',
      scope_id: 5,
      title: 'New Event',
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      candidates: [{ candidate_name: 'A' }, { candidate_name: 'B' }],
    };

    it('rejects a UNIFIED caller supplying a uid that is not their own (impersonation attempt)', async () => {
      // Real OrgService.resolveCallerUid throws when requestedUid doesn't
      // belong to the caller's pid -- this is the fix for the gap where the
      // old no-op assertOrgIdentity() let any UNIFIED caller name any real
      // organizer's uid and pass the member_roles check as that person.
      orgService.resolveCallerUid.mockRejectedValue(
        new ForbiddenException('requested uid does not belong to your account'),
      );

      await expect(
        service.createEvent(unifiedOrgAUser, { ...baseDto } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.member_roles.findFirst).not.toHaveBeenCalled();
      expect(prisma.events.create).not.toHaveBeenCalled();
    });

    it('rejects if the resolved caller uid ever mismatches dto.uid (defense in depth)', async () => {
      orgService.resolveCallerUid.mockResolvedValue('SOMEONE_ELSE');

      await expect(
        service.createEvent(unifiedOrgBUser, { ...baseDto } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.events.create).not.toHaveBeenCalled();
    });

    it('rejects ORG-session caller whose session orgid does not match dto.orgid (regression)', async () => {
      await expect(
        service.createEvent(orgSessionOrgAUser, { ...baseDto } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(orgService.resolveCallerUid).not.toHaveBeenCalled();
    });

    it('allows a UNIFIED caller creating an event as their own verified uid in their own org', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');
      prisma.member_roles.findFirst.mockResolvedValue({
        orgid: 'ORG_B',
        uid: 'U_B1',
        is_organizer: true,
        scope_id: 5,
      });
      prisma.org_scope.findFirst.mockResolvedValue({
        scope_id: 5,
        orgid: 'ORG_B',
      });
      prisma.$queryRaw.mockResolvedValue([{ scope_id: 5 }]);

      const result = await service.createEvent(
        unifiedOrgBUser,
        { ...baseDto } as any,
      );

      expect(result).toBeDefined();
      expect(prisma.events.create).toHaveBeenCalled();
      expect(orgService.resolveCallerUid).toHaveBeenCalledWith(
        unifiedOrgBUser,
        'ORG_B',
        'U_B1',
      );
    });

    it('allows an ORG-session organizer creating an event in their own org (regression)', async () => {
      orgService.resolveCallerUid.mockResolvedValue('U_B1');
      prisma.member_roles.findFirst.mockResolvedValue({
        orgid: 'ORG_B',
        uid: 'U_B1',
        is_organizer: true,
        scope_id: 5,
      });
      prisma.org_scope.findFirst.mockResolvedValue({
        scope_id: 5,
        orgid: 'ORG_B',
      });
      prisma.$queryRaw.mockResolvedValue([{ scope_id: 5 }]);

      const result = await service.createEvent(
        orgSessionOrgBUser,
        { ...baseDto } as any,
      );

      expect(result).toBeDefined();
      expect(prisma.events.create).toHaveBeenCalled();
    });
  });
});
