import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrgLimitRequestsService } from './org-limit-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgService } from './org.service';
import { OrgLimitRequestEmailService } from './org-limit-request-email.service';

// ─── OrgLimitRequestsService unit tests ────────────────────────────────────
//
// Scope:
//   - organizer-only submit guard
//   - one-open-request-per-org guard
//   - approve() applying the new limit atomically
//   - concurrent submit race
//
// Plus light coverage of the notification wiring (submit()/approve()
// firing the right email with the right arguments).
//
// Mocking shape mirrors admin-review-queue.service.spec.ts /
// org-requests.finalize.spec.ts: PrismaService is a hand-built stub rather
// than a real client, and $transaction hands its callback a `__tx` object
// that re-exposes the same mocked table methods approve()/reject()/
// requestInfo() call inside the lock — this is a unit test for this
// service's own control flow (guards, atomicity of *which calls happen
// inside the transaction*, error mapping), not a test of Prisma or of
// trg_check_limit_request_organizer / unique_open_limit_request themselves
// (those are DB-level and covered by the integration spec's own disclaimer
// pattern, same as org-request-lifecycle.integration.spec.ts).
function makeUniqueViolation(target: string) {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: '5.0.0',
    meta: { target: [target] },
  });
}

describe('OrgLimitRequestsService', () => {
  let service: OrgLimitRequestsService;
  let prisma: any;
  let orgService: { assertOrganizerAccess: jest.Mock };
  let emailService: {
    sendSubmitted: jest.Mock;
    sendApproved: jest.Mock;
    sendRejected: jest.Mock;
    sendNeedsInfo: jest.Mock;
  };

  const orgid = 'RIV0001';
  const uid = 'FOUNDER1';
  const adminId = 'ADMIN01';

  const baseOrg = { org_name: 'Riverside Rowing Club', member_limit: 10, is_deleted: false };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ ...baseOrg }),
      },
      org_members: {
        findUnique: jest.fn().mockResolvedValue({ email: 'organizer@example.com' }),
      },
      org_member_limit_requests: {
        findFirst: jest.fn().mockResolvedValue(null), // no existing open request by default
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      site_admins: {
        findUnique: jest.fn().mockResolvedValue({ admin_id: adminId, is_active: true }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma.__tx)),
      __tx: {
        $queryRaw: jest.fn(),
        organization: { update: jest.fn().mockResolvedValue({}) },
        org_member_limit_requests: { update: jest.fn() },
        admin_audit_log: { create: jest.fn().mockResolvedValue({}) },
      },
    };

    orgService = { assertOrganizerAccess: jest.fn().mockResolvedValue(undefined) };
    emailService = {
      sendSubmitted: jest.fn().mockResolvedValue(undefined),
      sendApproved: jest.fn().mockResolvedValue(undefined),
      sendRejected: jest.fn().mockResolvedValue(undefined),
      sendNeedsInfo: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgLimitRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrgService, useValue: orgService },
        { provide: OrgLimitRequestEmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(OrgLimitRequestsService);
  });

  // ── organizer-only submit guard ─────────────────────────────────────────
  describe('submit() — organizer-only guard', () => {
    it('delegates the organizer check to OrgService before touching the org row', async () => {
      prisma.org_member_limit_requests.create.mockResolvedValue({
        request_id: 1n,
        orgid,
        requested_by_uid: uid,
        current_limit: 10,
        requested_limit: 20,
        justification: null,
        status: 'PENDING',
        created_at: new Date(),
      });

      await service.submit(orgid, uid, 20, 'need more room');

      expect(orgService.assertOrganizerAccess).toHaveBeenCalledWith(orgid, uid);
    });

    it('propagates a non-organizer rejection without ever calling create()', async () => {
      orgService.assertOrganizerAccess.mockRejectedValue(
        new ForbiddenException('Organizer access required'),
      );

      await expect(service.submit(orgid, uid, 20)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.org_member_limit_requests.create).not.toHaveBeenCalled();
      expect(emailService.sendSubmitted).not.toHaveBeenCalled();
    });
  });

  // ── one-open-request-per-org guard ──────────────────────────────────────
  describe('submit() — one open request per org', () => {
    it('rejects with a friendly message when an open request already exists (pre-check)', async () => {
      prisma.org_member_limit_requests.findFirst.mockResolvedValue({
        request_id: 5n,
        status: 'PENDING',
      });

      await expect(service.submit(orgid, uid, 20)).rejects.toThrow(
        ConflictException,
      );
      // Never reached create() — the friendly pre-check caught it first.
      expect(prisma.org_member_limit_requests.create).not.toHaveBeenCalled();
      expect(emailService.sendSubmitted).not.toHaveBeenCalled();
    });

    // ── concurrent submit race ─────────────────────────────────────────────
    it('maps a lost race against unique_open_limit_request to a clean ConflictException', async () => {
      // The friendly pre-check sees nothing open (a second caller's request
      // hasn't committed yet from this caller's point of view)...
      prisma.org_member_limit_requests.findFirst.mockResolvedValue(null);
      // ...but the DB-level unique partial index catches the race when both
      // submissions try to INSERT.
      prisma.org_member_limit_requests.create.mockRejectedValue(
        makeUniqueViolation('unique_open_limit_request'),
      );

      await expect(service.submit(orgid, uid, 20)).rejects.toThrow(
        ConflictException,
      );
      expect(emailService.sendSubmitted).not.toHaveBeenCalled();
    });

    it('does not swallow an unrelated unique violation as a duplicate-request error', async () => {
      prisma.org_member_limit_requests.findFirst.mockResolvedValue(null);
      const unrelated = makeUniqueViolation('some_other_constraint');
      prisma.org_member_limit_requests.create.mockRejectedValue(unrelated);

      await expect(service.submit(orgid, uid, 20)).rejects.toBe(unrelated);
    });
  });

  describe('submit() — other preconditions', () => {
    it('rejects a requested_limit at or below the current limit', async () => {
      await expect(service.submit(orgid, uid, baseOrg.member_limit)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.org_member_limit_requests.create).not.toHaveBeenCalled();
    });

    it('fires sendSubmitted with the requester email and the before/after limits on success', async () => {
      prisma.org_member_limit_requests.create.mockResolvedValue({
        request_id: 9n,
        orgid,
        requested_by_uid: uid,
        current_limit: 10,
        requested_limit: 25,
        justification: null,
        status: 'PENDING',
        created_at: new Date(),
      });

      await service.submit(orgid, uid, 25);

      expect(emailService.sendSubmitted).toHaveBeenCalledWith(
        'organizer@example.com',
        9n,
        baseOrg.org_name,
        10,
        25,
      );
    });
  });

  // ── approve() applying the new limit atomically ─────────────────────────
  describe('approve()', () => {
    const requestId = 3n;

    function seedOpenRequest(overrides: Partial<any> = {}) {
      const row = {
        request_id: requestId,
        orgid,
        status: 'PENDING',
        requested_limit: 30,
        requested_by_uid: uid,
        ...overrides,
      };
      prisma.org_member_limit_requests.findUnique.mockResolvedValue(row);
      prisma.__tx.$queryRaw.mockResolvedValue([row]);
      return row;
    }

    it('raises organization.member_limit and closes the request inside one transaction', async () => {
      seedOpenRequest();
      prisma.__tx.org_member_limit_requests.update.mockResolvedValue({
        request_id: requestId,
        orgid,
        requested_limit: 30,
        requested_by_uid: uid,
        status: 'APPROVED',
      });

      const result = await service.approve(requestId, adminId);

      expect(result.status).toBe('APPROVED');
      expect(result.new_member_limit).toBe(30);
      // Both writes happened against the SAME locked transaction, not the
      // outer prisma client — proves the grant is atomic with the status
      // flip rather than two independent statements.
      expect(prisma.__tx.organization.update).toHaveBeenCalledWith({
        where: { orgid },
        data: { member_limit: 30 },
      });
      expect(prisma.__tx.org_member_limit_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { request_id: requestId },
          data: expect.objectContaining({ status: 'APPROVED', reviewed_by_admin_id: adminId }),
        }),
      );
      expect(prisma.__tx.admin_audit_log.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'MEMBER_LIMIT_INCREASE_APPROVED',
            target_type: 'MEMBER_LIMIT_REQUEST',
            target_id: String(requestId),
          }),
        }),
      );
    });

    it('sends the approval email with the new limit after the transaction commits', async () => {
      seedOpenRequest();
      prisma.__tx.org_member_limit_requests.update.mockResolvedValue({
        request_id: requestId,
        orgid,
        requested_limit: 30,
        requested_by_uid: uid,
        status: 'APPROVED',
      });

      await service.approve(requestId, adminId);

      expect(emailService.sendApproved).toHaveBeenCalledWith(
        'organizer@example.com',
        requestId,
        baseOrg.org_name,
        30,
      );
    });

    it('rejects (fast pre-check) a request that is already closed, without opening a transaction', async () => {
      seedOpenRequest({ status: 'APPROVED' });

      await expect(service.approve(requestId, adminId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects under the lock when a concurrent reviewer already closed the request (race caught inside the transaction)', async () => {
      // Unlocked pre-fetch still sees PENDING...
      prisma.org_member_limit_requests.findUnique.mockResolvedValue({
        request_id: requestId,
        orgid,
        status: 'PENDING',
        requested_limit: 30,
        requested_by_uid: uid,
      });
      // ...but a concurrent reject() won the race and committed first, so
      // the row read under FOR UPDATE is already REJECTED.
      prisma.__tx.$queryRaw.mockResolvedValue([
        { request_id: requestId, orgid, status: 'REJECTED', requested_limit: 30, requested_by_uid: uid },
      ]);

      await expect(service.approve(requestId, adminId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.__tx.organization.update).not.toHaveBeenCalled();
      expect(emailService.sendApproved).not.toHaveBeenCalled();
    });

    it('requires an active site admin', async () => {
      prisma.site_admins.findUnique.mockResolvedValue({ admin_id: adminId, is_active: false });
      seedOpenRequest();

      await expect(service.approve(requestId, adminId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s for a request id that does not exist', async () => {
      prisma.org_member_limit_requests.findUnique.mockResolvedValue(null);

      await expect(service.approve(requestId, adminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── reject()/requestInfo() notification wiring, light coverage ────
  describe('reject() and requestInfo()', () => {
    const requestId = 4n;

    beforeEach(() => {
      const row = { request_id: requestId, orgid, status: 'PENDING', requested_by_uid: uid };
      prisma.org_member_limit_requests.findUnique.mockResolvedValue(row);
      prisma.__tx.$queryRaw.mockResolvedValue([row]);
    });

    it('reject() sends sendRejected with the review note after committing', async () => {
      prisma.__tx.org_member_limit_requests.update.mockResolvedValue({
        request_id: requestId,
        orgid,
        requested_by_uid: uid,
        status: 'REJECTED',
      });

      await service.reject(requestId, adminId, 'Not enough justification');

      expect(emailService.sendRejected).toHaveBeenCalledWith(
        'organizer@example.com',
        requestId,
        baseOrg.org_name,
        'Not enough justification',
      );
    });

    it('reject() requires a non-empty reason', async () => {
      await expect(service.reject(requestId, adminId, '   ')).rejects.toThrow(
        BadRequestException,
      );
      expect(emailService.sendRejected).not.toHaveBeenCalled();
    });

    it('requestInfo() sends sendNeedsInfo with the review note after committing', async () => {
      prisma.__tx.org_member_limit_requests.update.mockResolvedValue({
        request_id: requestId,
        orgid,
        requested_by_uid: uid,
        status: 'NEEDS_INFO',
      });

      await service.requestInfo(requestId, adminId, 'Please clarify projected growth');

      expect(emailService.sendNeedsInfo).toHaveBeenCalledWith(
        'organizer@example.com',
        requestId,
        baseOrg.org_name,
        'Please clarify projected growth',
      );
    });
  });
});
