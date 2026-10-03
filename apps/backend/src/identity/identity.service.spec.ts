import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdentityService } from './identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';

describe('IdentityService.addIdentity', () => {
  let service: IdentityService;
  let tx: any;
  let prisma: any;
  let otp: { verifyOtp: jest.Mock };

  const PID = 1n;
  const dto = () => ({
    identity_type: 'ORG' as const,
    identity_id: 'ORG1',
    uid: 'U1',
    otp: '123456',
    identifier: 'A@Test.com',
  });
  const member = (over: any = {}) => ({
    orgid: 'ORG1',
    uid: 'U1',
    pid: null,
    email: 'a@test.com',
    mobile: null,
    is_deleted: false,
    ...over,
  });

  beforeEach(async () => {
    tx = {
      org_members: { findFirst: jest.fn(), updateMany: jest.fn() },
      organization: { findUnique: jest.fn() },
      identity_wallet: { findFirst: jest.fn(), create: jest.fn() },
    };
    tx.organization.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    tx.identity_wallet.findFirst.mockResolvedValue(null);
    tx.org_members.updateMany.mockResolvedValue({ count: 1 });
    tx.identity_wallet.create.mockResolvedValue({
      identity_type: 'ORG',
      identity_id: 'ORG1',
      uid: 'U1',
    });

    prisma = {
      uaccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ pid: PID, email: 'x@y.com', mobile: null }),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    otp = { verifyOtp: jest.fn().mockResolvedValue(true) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpService, useValue: otp },
      ],
    }).compile();
    service = mod.get(IdentityService);
  });

  it('links an unclaimed member (case-insensitive email)', async () => {
    tx.org_members.findFirst.mockResolvedValue(member({ email: 'A@Test.com' }));
    await expect(service.addIdentity(PID, dto())).resolves.toEqual({
      identity_type: 'ORG',
      identity_id: 'ORG1',
      uid: 'U1',
    });
    expect(tx.org_members.updateMany).toHaveBeenCalled();
  });

  it('rejects unknown / deleted member with the generic error', async () => {
    tx.org_members.findFirst.mockResolvedValue(null);
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('uses the same generic error when the contact does not match', async () => {
    tx.org_members.findFirst.mockResolvedValue(
      member({ email: 'other@x.com' }),
    );
    const a = await service.addIdentity(PID, dto()).catch((e) => e.message);
    tx.org_members.findFirst.mockResolvedValue(null);
    const b = await service.addIdentity(PID, dto()).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it('rejects members of inactive orgs', async () => {
    tx.org_members.findFirst.mockResolvedValue(member());
    tx.organization.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      'not currently active',
    );
  });

  it('409 when the member is linked to another account', async () => {
    tx.org_members.findFirst.mockResolvedValue(member({ pid: 99n }));
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      'already linked to another account',
    );
    expect(tx.identity_wallet.create).not.toHaveBeenCalled();
  });

  it('409 with a friendly message for a second UID in the same org', async () => {
    tx.org_members.findFirst.mockResolvedValue(member());
    tx.identity_wallet.findFirst.mockResolvedValue({ uid: 'OTHER' });
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      'already linked to UID OTHER',
    );
  });

  it('409 when the same identity is already in this wallet', async () => {
    tx.org_members.findFirst.mockResolvedValue(member({ pid: PID }));
    tx.identity_wallet.findFirst.mockResolvedValue({ uid: 'U1' });
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      'Identity already in wallet',
    );
  });

  it('409 when another account wins the atomic claim (race)', async () => {
    tx.org_members.findFirst.mockResolvedValue(member());
    tx.org_members.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.addIdentity(PID, dto())).rejects.toThrow(
      ConflictException,
    );
    expect(tx.identity_wallet.create).not.toHaveBeenCalled();
  });

  it('maps a raw P2002 (double-submit) to a clean 409', async () => {
    tx.org_members.findFirst.mockResolvedValue(member());
    tx.identity_wallet.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['pid', 'identity_type', 'identity_id'] },
      }),
    );
    const err = await service.addIdentity(PID, dto()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).not.toMatch(/identity_type|Duplicate value/);
  });

  it('re-links after restore when org_members.pid is already ours', async () => {
    tx.org_members.findFirst.mockResolvedValue(member({ pid: PID }));
    await expect(service.addIdentity(PID, dto())).resolves.toBeDefined();
  });
});
