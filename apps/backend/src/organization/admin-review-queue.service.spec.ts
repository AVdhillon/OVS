import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminReviewQueueService } from './admin-review-queue.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── AdminReviewQueueService unit tests ──────────────────────────
//
// Scope: this is a thin read layer over the admin_review_queue view (a raw
// SQL view, no Prisma model — see the service's own header comment), so
// there's no real DB to hit here. What's actually worth unit-testing is the
// validation/defaulting logic that runs BEFORE the query — a bad ?status=
// or ?request_type= must 400 rather than silently querying with bogus
// values — plus that the two $queryRaw calls get built with the resolved
// filters and that the bigint COUNT(*) comes back as a plain number.
describe('AdminReviewQueueService', () => {
  let service: AdminReviewQueueService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminReviewQueueService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = module.get<AdminReviewQueueService>(AdminReviewQueueService);
  });

  // Both $queryRaw calls list() fires (rows, then count) resolve in the
  // order the Promise.all() call site issues them.
  function mockRowsThenCount(rows: unknown[], count: number) {
    queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([
      { count: BigInt(count) },
    ]);
  }

  it('defaults to PENDING + NEEDS_INFO (open statuses) and page 1 / size 25 when nothing is passed', async () => {
    mockRowsThenCount([], 0);

    const result = await service.list();

    expect(result).toEqual({ requests: [], total: 0, page: 1, page_size: 25 });
    // Both calls should have gone out with the resolved default filters —
    // sniff the tagged-template values rather than the SQL text, since the
    // exact query string isn't what's under test here.
    const firstCallValues = queryRaw.mock.calls[0].slice(1);
    expect(firstCallValues[0]).toEqual(['PENDING', 'NEEDS_INFO']);
    expect(firstCallValues[1]).toEqual(['ORG_CREATION', 'MEMBER_LIMIT_INCREASE']);
  });

  it('accepts a status valid only on the org_requests side (APPROVED_PENDING_SETUP)', async () => {
    mockRowsThenCount([], 0);

    await service.list({ status: ['APPROVED_PENDING_SETUP'] });

    expect(queryRaw.mock.calls[0].slice(1)[0]).toEqual([
      'APPROVED_PENDING_SETUP',
    ]);
  });

  it('accepts a status shared by both tables (REJECTED) without needing request_type', async () => {
    mockRowsThenCount([], 0);

    await service.list({ status: ['rejected'] });

    expect(queryRaw.mock.calls[0].slice(1)[0]).toEqual(['REJECTED']);
  });

  it('rejects a status that belongs to neither table', async () => {
    await expect(service.list({ status: ['BOGUS'] })).rejects.toThrow(
      BadRequestException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised request_type', async () => {
    await expect(
      service.list({ requestType: ['SOMETHING_ELSE'] }),
    ).rejects.toThrow(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('normalises page/page_size and caps page_size at 100', async () => {
    mockRowsThenCount([], 0);

    const result = await service.list({ page: 3, pageSize: 500 });

    expect(result.page).toBe(3);
    expect(result.page_size).toBe(100);
  });

  it('coerces the bigint COUNT(*) result into a plain number', async () => {
    mockRowsThenCount([{ id: '1' }], 42);

    const result = await service.list();

    expect(result.total).toBe(42);
    expect(typeof result.total).toBe('number');
  });
});
