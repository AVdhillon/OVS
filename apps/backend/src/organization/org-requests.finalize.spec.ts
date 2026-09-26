import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRequestsService } from './org-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { OrgRequestEmailService } from './org-request-email.service';
import { FinalizeOrgRequestDto } from './dto/finalize-org-request.dto';
import * as orgCreation from './org-creation.utilities';

// ─── finalizeSetup() unit tests (Phase 6, subphase 6.7) ────────────────────
//
// Scope, per post-approval-org-setup-plan.md's 6.7 section:
//   - preferred-orgid conflict
//   - generated-orgid path
//   - uid format validation
//   - org_email-changed-triggers-reverify
//   - the locked-row race (a second finalize call / a status change under
//     the FOR UPDATE lock)
//
// Deliberately does NOT mock orgid.utilities.ts's runWithUniqueOrgId() or
// resolveInitialOrgId() — those are exercised for real, against a mocked
// PrismaService, so the preferred-vs-generated branching and the
// lock-then-recheck logic inside finalizeSetup()'s own `body` callback are
// actually run, not assumed. createOrganizationCore() (org-creation.utilities.ts)
// IS mocked: it's a six-INSERT function already covered by its own module,
// and finalizeSetup() only needs to know it was called with the right
// arguments and that its result is threaded through.
jest.mock('./org-creation.utilities', () => ({
  ...jest.requireActual('./org-creation.utilities'),
  createOrganizationCore: jest.fn(),
}));

describe('OrgRequestsService.finalizeSetup()', () => {
  let service: OrgRequestsService;
  let prisma: any;
  let otpService: { verifyOtp: jest.Mock };
  let emailService: { sendApproved: jest.Mock; sendApprovedPendingSetup: jest.Mock };

  const pid = 42n;
  const requestId = 7n;

  const baseRequester = {
    pid,
    email: 'requester@example.com',
    mobile: null,
    created_at: new Date('2024-01-01'),
  };

  const baseRequest = {
    request_id: requestId,
    pid,
    status: 'APPROVED_PENDING_SETUP',
    reference_code: 'ORQ-0000007',
    org_name: 'Riverside Rowing Club',
    org_email: 'contact@riverside.example',
    admin_set_member_limit: 25,
  };

  function makeDto(overrides: Partial<FinalizeOrgRequestDto> = {}) {
    const dto = new FinalizeOrgRequestDto();
    dto.orgid_choice = { mode: 'generate' } as any;
    dto.org_email = baseRequest.org_email;
    dto.owner_uid = 'OWNER01';
    return Object.assign(dto, overrides);
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      uaccount: { findUnique: jest.fn().mockResolvedValue(baseRequester) },
      org_requests: {
        findUnique: jest.fn().mockResolvedValue({ ...baseRequest }),
      },
      organization: {
        // Backs resolveInitialOrgId()'s pre-check (orgid.utilities.ts):
        // no collision by default, for either a preferred or generated ID.
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // $transaction is invoked by runWithUniqueOrgId() as
      // prisma.$transaction((tx) => body(tx, orgid)) — hand the callback a
      // tx object that re-exposes the same $queryRaw mock, plus the
      // org_requests.update finalizeSetup()'s body calls directly.
      $transaction: jest.fn(async (cb: any) => cb(prisma.__tx)),
      __tx: {
        $queryRaw: jest.fn(),
        org_requests: {
          update: jest.fn().mockResolvedValue({
            reference_code: baseRequest.reference_code,
            org_name: baseRequest.org_name,
          }),
        },
      },
    };

    otpService = { verifyOtp: jest.fn().mockResolvedValue(true) };
    emailService = {
      sendApproved: jest.fn().mockResolvedValue(undefined),
      sendApprovedPendingSetup: jest.fn().mockResolvedValue(undefined),
    };

    (orgCreation.createOrganizationCore as jest.Mock).mockResolvedValue({
      org: { org_name: baseRequest.org_name },
      rootScope: { scope_id: 1 },
    });

    // Default: the row is still APPROVED_PENDING_SETUP when re-read under
    // the lock inside the transaction — the non-race happy path.
    prisma.__tx.$queryRaw.mockResolvedValue([
      {
        request_id: requestId,
        pid,
        status: 'APPROVED_PENDING_SETUP',
        reference_code: baseRequest.reference_code,
        org_name: baseRequest.org_name,
        admin_set_member_limit: baseRequest.admin_set_member_limit,
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpService, useValue: otpService },
        { provide: OrgRequestEmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<OrgRequestsService>(OrgRequestsService);
  });

  // ── Happy path (unchanged email, generated orgid) ─────────────────────────
  it('creates the org on the generated-orgid path when nothing else changed', async () => {
    const result = await service.finalizeSetup(requestId, pid, makeDto());

    expect(result.status).toBe('APPROVED');
    expect(result.org_name).toBe(baseRequest.org_name);
    expect(typeof result.orgid).toBe('string');
    expect(result.orgid).toMatch(/^[A-Z]{3}[0-9]{4}$/);
    expect(orgCreation.createOrganizationCore).toHaveBeenCalledWith(
      prisma.__tx,
      result.orgid,
      baseRequest.org_name,
      expect.objectContaining({
        orgEmail: baseRequest.org_email,
        owner: { pid, uid: 'OWNER01', identifier: baseRequester.email },
        memberLimit: baseRequest.admin_set_member_limit,
      }),
    );
    expect(prisma.__tx.org_requests.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { request_id: requestId },
        data: expect.objectContaining({
          status: 'APPROVED',
          approved_orgid: result.orgid,
          org_email: baseRequest.org_email,
        }),
      }),
    );
    // Email fires only after the transaction has committed.
    expect(emailService.sendApproved).toHaveBeenCalledWith(
      baseRequester.email,
      baseRequest.reference_code,
      baseRequest.org_name,
      result.orgid,
    );
  });

  // ── Preferred-orgid conflict ───────────────────────────────────────────────
  describe('preferred orgid', () => {
    it('takes the caller-chosen orgid when it is free', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const result = await service.finalizeSetup(
        requestId,
        pid,
        makeDto({ orgid_choice: { mode: 'preferred', orgid: 'ABC1234' } as any }),
      );

      expect(result.orgid).toBe('ABC1234');
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { orgid: 'ABC1234' },
      });
    });

    it('rejects a preferred orgid that is already taken, without retrying with a different one', async () => {
      // resolveInitialOrgId()'s pre-check finds an existing org with this id.
      prisma.organization.findUnique.mockResolvedValue({ orgid: 'ABC1234' });

      await expect(
        service.finalizeSetup(
          requestId,
          pid,
          makeDto({ orgid_choice: { mode: 'preferred', orgid: 'ABC1234' } as any }),
        ),
      ).rejects.toThrow(ConflictException);

      // Never even got to the transaction — a preferred ID conflict is
      // reported directly, not silently substituted.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(orgCreation.createOrganizationCore).not.toHaveBeenCalled();
    });
  });

  // ── Generated-orgid path ───────────────────────────────────────────────────
  describe('generated orgid', () => {
    it('retries with a fresh id when the first generated candidate collides, then succeeds', async () => {
      // First existence check (inside resolveInitialOrgId's pre-check loop)
      // says taken; second says free.
      prisma.organization.findUnique
        .mockResolvedValueOnce({ orgid: 'TAKEN' })
        .mockResolvedValueOnce(null);

      const result = await service.finalizeSetup(requestId, pid, makeDto());

      expect(result.status).toBe('APPROVED');
      expect(prisma.organization.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ── uid format validation (DTO-level) ──────────────────────────────────────
  describe('owner_uid format validation', () => {
    it('rejects a lowercase uid', async () => {
      const dto = plainToInstance(FinalizeOrgRequestDto, {
        orgid_choice: { mode: 'generate' },
        org_email: baseRequest.org_email,
        owner_uid: 'owner01',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'owner_uid')).toBe(true);
    });

    it('rejects a uid shorter than 4 characters', async () => {
      const dto = plainToInstance(FinalizeOrgRequestDto, {
        orgid_choice: { mode: 'generate' },
        org_email: baseRequest.org_email,
        owner_uid: 'AB1',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'owner_uid')).toBe(true);
    });

    it('rejects a uid with punctuation', async () => {
      const dto = plainToInstance(FinalizeOrgRequestDto, {
        orgid_choice: { mode: 'generate' },
        org_email: baseRequest.org_email,
        owner_uid: 'OWNER-1',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'owner_uid')).toBe(true);
    });

    it('accepts a valid 4-20 char uppercase-alphanumeric uid', async () => {
      const dto = plainToInstance(FinalizeOrgRequestDto, {
        orgid_choice: { mode: 'generate' },
        org_email: baseRequest.org_email,
        owner_uid: 'OWNER01',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'owner_uid')).toBe(false);
    });

    it('normalizes owner_uid to uppercase before use (service-level)', async () => {
      const result = await service.finalizeSetup(
        requestId,
        pid,
        makeDto({ owner_uid: 'owner01' }),
      );
      expect(result.status).toBe('APPROVED');
      expect(orgCreation.createOrganizationCore).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          owner: expect.objectContaining({ uid: 'OWNER01' }),
        }),
      );
    });
  });

  // ── org_email changed -> re-verification required ──────────────────────────
  describe('org_email re-verification', () => {
    it('does not call verifyOtp when org_email is unchanged from the request', async () => {
      await service.finalizeSetup(requestId, pid, makeDto());
      expect(otpService.verifyOtp).not.toHaveBeenCalled();
    });

    it('rejects a changed org_email with no otp supplied', async () => {
      await expect(
        service.finalizeSetup(
          requestId,
          pid,
          makeDto({ org_email: 'new-contact@riverside.example' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(otpService.verifyOtp).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('verifies the otp against the new email and purpose when org_email changed', async () => {
      const result = await service.finalizeSetup(
        requestId,
        pid,
        makeDto({
          org_email: 'New-Contact@Riverside.example',
          org_email_otp: '123456',
        }),
      );

      expect(otpService.verifyOtp).toHaveBeenCalledWith(
        'new-contact@riverside.example',
        '123456',
        'ORG_DOMAIN_OWNERSHIP',
      );
      expect(result.status).toBe('APPROVED');
      // The (lowercased) new email is what's persisted onto the request/org,
      // not the original submission's org_email.
      expect(prisma.__tx.org_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_email: 'new-contact@riverside.example',
          }),
        }),
      );
    });

    it('treats a same-address-different-case org_email as unchanged (no otp required)', async () => {
      const result = await service.finalizeSetup(
        requestId,
        pid,
        makeDto({ org_email: baseRequest.org_email!.toUpperCase() }),
      );
      expect(otpService.verifyOtp).not.toHaveBeenCalled();
      expect(result.status).toBe('APPROVED');
    });

    it('propagates verifyOtp rejecting a wrong/expired code', async () => {
      otpService.verifyOtp.mockRejectedValue(
        new BadRequestException('Invalid or expired code'),
      );

      await expect(
        service.finalizeSetup(
          requestId,
          pid,
          makeDto({
            org_email: 'new-contact@riverside.example',
            org_email_otp: 'WRONG',
          }),
        ),
      ).rejects.toThrow('Invalid or expired code');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ── The locked-row race ─────────────────────────────────────────────────────
  describe('locked-row race', () => {
    it('rejects when the request is no longer APPROVED_PENDING_SETUP under the lock (already finalized by a concurrent call)', async () => {
      // The unlocked pre-fetch still sees APPROVED_PENDING_SETUP (default
      // mock), but a second finalize call already committed first — under
      // the FOR UPDATE lock inside *this* call's transaction, the row now
      // reads APPROVED.
      prisma.__tx.$queryRaw.mockResolvedValue([
        {
          request_id: requestId,
          pid,
          status: 'APPROVED',
          reference_code: baseRequest.reference_code,
          org_name: baseRequest.org_name,
          admin_set_member_limit: baseRequest.admin_set_member_limit,
        },
      ]);

      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(ConflictException);

      expect(orgCreation.createOrganizationCore).not.toHaveBeenCalled();
      expect(prisma.__tx.org_requests.update).not.toHaveBeenCalled();
      expect(emailService.sendApproved).not.toHaveBeenCalled();
    });

    it('rejects when the locked row belongs to a different pid than the pre-fetch saw', async () => {
      prisma.__tx.$queryRaw.mockResolvedValue([
        {
          request_id: requestId,
          pid: 999n,
          status: 'APPROVED_PENDING_SETUP',
          reference_code: baseRequest.reference_code,
          org_name: baseRequest.org_name,
          admin_set_member_limit: baseRequest.admin_set_member_limit,
        },
      ]);

      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not retry the whole finalize on a lost race (unlike an orgid collision)', async () => {
      prisma.__tx.$queryRaw.mockResolvedValue([
        {
          request_id: requestId,
          pid,
          status: 'REJECTED',
          reference_code: baseRequest.reference_code,
          org_name: baseRequest.org_name,
          admin_set_member_limit: baseRequest.admin_set_member_limit,
        },
      ]);

      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(ConflictException);

      // A ConflictException from inside body isn't an orgid collision, so
      // runWithUniqueOrgId() must not swallow it and retry with a new id.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── Pre-checks unrelated to the 6.7 list, kept for coverage of the guard
  // rails finalizeSetup() itself adds before ever reaching the transaction.
  describe('outer pre-checks', () => {
    it('reports not-found for a request belonging to a different pid, same as a nonexistent one', async () => {
      prisma.org_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        pid: 999n,
      });
      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a request that is not APPROVED_PENDING_SETUP', async () => {
      prisma.org_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        status: 'PENDING',
      });
      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(ConflictException);
    });

    it('requires a contactable unified account', async () => {
      prisma.uaccount.findUnique.mockResolvedValue({
        ...baseRequester,
        email: null,
        mobile: null,
      });
      await expect(
        service.finalizeSetup(requestId, pid, makeDto()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
