import { Test, TestingModule } from '@nestjs/testing';
import { OrgLimitRequestsService } from './org-limit-requests.service';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgLimitRequestEmailService } from './org-limit-request-email.service';
import { AddMembersDto } from './dto/add-members.dto';

// ─── Integration: submit → approve → organization.member_limit updated → a
// previously-blocked member add now succeeds (Phase 7, subphase 7.6) ───────
//
// post-approval-org-setup-plan.md's 7.6 section calls for exactly this run.
// Same shape/spirit as org-request-lifecycle.integration.spec.ts (Phase 6,
// subphase 6.7): the real OrgLimitRequestsService.submit()/approve() and
// OrgService.addMembers() code runs end to end against a small in-memory
// fake standing in for PrismaService, rather than a real Postgres instance.
//
// What this test IS: proof that raising organization.member_limit via the
// full submit()->approve() pipeline actually unblocks org.service.ts's own
// addMembers() pre-check for THIS specific org, with no manual UPDATE in
// between — i.e. approve()'s transactional write really does land where
// addMembers() reads from.
//
// What this test is NOT: a substitute for running this against a real
// Postgres instance. trg_check_limit_request_organizer and
// unique_open_limit_request (7.1, dbschema.sql) are DB-level guarantees —
// there is no SQL engine here to execute them — so this only proves the
// service-level guards (assertOrganizerAccess(), the findFirst-based
// duplicate-request pre-check) and the addMembers() member-limit pre-check.
// Same limitation the 6.7 integration spec already documents for
// trg_check_member_limit.
//
// Outbound email (org-limit-request-email.service.ts, 7.5) is stubbed
// rather than faked in full — already exercised in isolation by
// org-limit-requests.service.spec.ts.

describe('member-limit-request lifecycle -> unblocks a capped org (integration)', () => {
  let limitRequestsService: OrgLimitRequestsService;
  let orgService: OrgService;
  let db: ReturnType<typeof createFakeOrgDb>;

  const orgid = 'RIV0001';
  const adminId = 'ADMIN01';
  const organizerUid = 'FOUNDER1';

  beforeEach(async () => {
    db = createFakeOrgDb();

    // Seed an org already sitting at a member_limit of 2, with its one
    // organizer as the only active member so far.
    db.organization.set(orgid, {
      orgid,
      org_name: 'Riverside Rowing Club',
      member_limit: 2,
      is_deleted: false,
    });
    db.org_scope.set(1, { scope_id: 1, orgid, parent_scope_id: null, scope_name: 'ROOT' });
    db.org_members.set(`${orgid}:${organizerUid}`, {
      orgid,
      uid: organizerUid,
      email: 'founder@example.com',
      mobile: null,
      is_deleted: false,
    });
    db.member_roles.set(`${orgid}:${organizerUid}:1`, {
      orgid,
      uid: organizerUid,
      scope_id: 1,
      is_organizer: true,
      is_voter: true,
    });
    // A second existing member fills the org to its current cap of 2.
    db.org_members.set(`${orgid}:MEMBER01`, {
      orgid,
      uid: 'MEMBER01',
      email: 'member01@example.com',
      mobile: null,
      is_deleted: false,
    });
    db.site_admins.set(adminId, { admin_id: adminId, is_active: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgLimitRequestsService,
        OrgService,
        { provide: PrismaService, useValue: db.prisma },
        {
          provide: OrgLimitRequestEmailService,
          useValue: {
            sendSubmitted: jest.fn().mockResolvedValue(undefined),
            sendApproved: jest.fn().mockResolvedValue(undefined),
            sendRejected: jest.fn().mockResolvedValue(undefined),
            sendNeedsInfo: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    limitRequestsService = module.get(OrgLimitRequestsService);
    orgService = module.get(OrgService);
  });

  it('carries a capped org from a blocked add through a limit increase to a successful add', async () => {
    // ── 0. Sanity: the org is at its cap of 2 already ───────────────────
    expect(await countActiveMembers(db, orgid)).toBe(2);

    // ── 1. addMembers() — blocked before any increase exists ───────────
    const thirdMemberDto: AddMembersDto = {
      participants: [
        { uid: 'MEMBER02', participant_identifier: 'member02@example.com', role: 'v' } as any,
      ],
    };
    const blockedAdd = await orgService.addMembers(
      1n, // pid — unused by addMembers() itself beyond signature
      orgid,
      organizerUid,
      thirdMemberDto,
    );
    expect(blockedAdd.results).toEqual([
      {
        uid: 'MEMBER02',
        status: 'error',
        error: 'Organization has reached its member limit of 2',
      },
    ]);
    expect(db.org_members.has(`${orgid}:MEMBER02`)).toBe(false);

    // ── 2. submit() — the organizer asks for more room ──────────────────
    const submitted = await limitRequestsService.submit(
      orgid,
      organizerUid,
      5,
      'Growing past our original headcount estimate.',
    );
    expect(submitted.status).toBe('PENDING');
    const requestId = BigInt(submitted.request_id as any);
    expect(db.org_member_limit_requests.get(requestId)?.current_limit).toBe(2);
    expect(db.org_member_limit_requests.get(requestId)?.requested_limit).toBe(5);
    // The cap hasn't moved yet — approval is what actually grants it.
    expect(db.organization.get(orgid)?.member_limit).toBe(2);

    // ── 3. A second open request for the same org is refused ────────────
    await expect(
      limitRequestsService.submit(orgid, organizerUid, 8, 'Also need more.'),
    ).rejects.toThrow(/already has an open member-limit request/);

    // ── 4. approve() — the cap is actually raised ────────────────────────
    const approved = await limitRequestsService.approve(requestId, adminId);
    expect(approved.status).toBe('APPROVED');
    expect(approved.new_member_limit).toBe(5);
    expect(db.organization.get(orgid)?.member_limit).toBe(5);
    expect(db.org_member_limit_requests.get(requestId)?.status).toBe('APPROVED');
    expect(db.admin_audit_log.some((a) => a.action === 'MEMBER_LIMIT_INCREASE_APPROVED')).toBe(
      true,
    );

    // ── 5. The previously-blocked add now succeeds ───────────────────────
    const secondAdd = await orgService.addMembers(1n, orgid, organizerUid, thirdMemberDto);
    expect(secondAdd.results).toEqual([{ uid: 'MEMBER02', status: 'added' }]);
    expect(db.org_members.has(`${orgid}:MEMBER02`)).toBe(true);
    expect(await countActiveMembers(db, orgid)).toBe(3);

    // ── 6. And a fresh limit-increase request can be submitted again, now
    // that the previous one is no longer open ───────────────────────────
    const secondRequest = await limitRequestsService.submit(orgid, organizerUid, 10);
    expect(secondRequest.status).toBe('PENDING');
    expect(secondRequest.current_limit).toBe(5);
  });
});

async function countActiveMembers(
  db: ReturnType<typeof createFakeOrgDb>,
  orgid: string,
): Promise<number> {
  let n = 0;
  for (const m of db.org_members.values()) {
    if (m.orgid === orgid && !m.is_deleted) n++;
  }
  return n;
}

// ─── Minimal in-memory fake standing in for PrismaService ──────────────────
//
// Implements only the tables/methods actually reached by
// OrgLimitRequestsService.submit()/approve() and OrgService.addMembers()/
// assertOrganizerAccess()/getCallerOrganizerScopes()/getDescendantScopeIds()
// — not a general Prisma stand-in. $transaction runs its callback against
// the same store synchronously, same as the Phase 6 integration spec's own
// fake (no concurrent callers here, so no isolation/rollback semantics are
// needed) — including the unique_open_limit_request race, which is
// exercised at the service layer's own findFirst-based pre-check (step 3
// above), not by simulating a real partial-unique-index collision.
function createFakeOrgDb() {
  const organization = new Map<string, any>();
  const org_scope = new Map<number, any>();
  const org_members = new Map<string, any>();
  const member_roles = new Map<string, any>();
  const org_member_limit_requests = new Map<bigint, any>();
  const site_admins = new Map<string, any>();
  const admin_audit_log: any[] = [];

  let nextRequestId = 1n;

  function memberKey(orgid: string, uid: string) {
    return `${orgid}:${uid}`;
  }
  function roleKey(orgid: string, uid: string, scope_id: number) {
    return `${orgid}:${uid}:${scope_id}`;
  }

  // Routes a tagged-template $queryRaw call by sniffing the SQL text — same
  // approach as the Phase 6 integration spec's own fake.
  function queryRaw(strings: TemplateStringsArray, ...values: any[]) {
    const sql = strings.join('?');
    if (sql.includes('get_scope_descendants')) {
      const scopeId = values[0];
      return Promise.resolve([{ scope_id: scopeId }]);
    }
    if (sql.includes('FROM org_member_limit_requests') && sql.includes('FOR UPDATE')) {
      const requestId = values[0] as bigint;
      const row = org_member_limit_requests.get(requestId);
      return Promise.resolve(row ? [{ ...row }] : []);
    }
    throw new Error(`fake $queryRaw: unrecognised query: ${sql}`);
  }

  const prisma: any = {
    organization: {
      findUnique: async ({ where: { orgid }, select }: any) => {
        const row = organization.get(orgid);
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
      update: async ({ where: { orgid }, data }: any) => {
        const row = organization.get(orgid);
        Object.assign(row, data);
        return row;
      },
    },
    org_scope: {
      findFirst: async ({ where }: any) => {
        for (const s of org_scope.values()) if (matches(s, where)) return s;
        return null;
      },
    },
    org_members: {
      findUnique: async ({ where: { orgid_uid }, select }: any) => {
        const row = org_members.get(memberKey(orgid_uid.orgid, orgid_uid.uid));
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
      create: async ({ data }: any) => {
        const row = { is_deleted: false, ...data };
        org_members.set(memberKey(row.orgid, row.uid), row);
        return row;
      },
      count: async ({ where }: any) => {
        let n = 0;
        for (const m of org_members.values()) if (matches(m, where)) n++;
        return n;
      },
    },
    member_roles: {
      create: async ({ data }: any) => {
        const row = { ...data };
        member_roles.set(roleKey(row.orgid, row.uid, row.scope_id), row);
        return row;
      },
      upsert: async ({ where: { orgid_uid_scope_id }, create, update }: any) => {
        const key = roleKey(
          orgid_uid_scope_id.orgid,
          orgid_uid_scope_id.uid,
          orgid_uid_scope_id.scope_id,
        );
        const existing = member_roles.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create };
        member_roles.set(key, row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        for (const r of member_roles.values()) if (matches(r, where)) return r;
        return null;
      },
      findMany: async ({ where, select }: any) => {
        const rows = [...member_roles.values()].filter((r) => matches(r, where));
        return select ? rows.map((r) => pick(r, select)) : rows;
      },
      count: async ({ where }: any) => {
        let n = 0;
        for (const r of member_roles.values()) if (matches(r, where)) n++;
        return n;
      },
    },
    org_member_limit_requests: {
      create: async ({ data, select }: any) => {
        const request_id = nextRequestId++;
        const row = {
          request_id,
          status: 'PENDING',
          justification: null,
          reviewed_by_admin_id: null,
          reviewed_at: null,
          review_note: null,
          created_at: new Date(),
          updated_at: new Date(),
          ...data,
        };
        org_member_limit_requests.set(request_id, row);
        return select ? pick(row, select) : row;
      },
      findFirst: async ({ where, select }: any) => {
        for (const r of org_member_limit_requests.values()) {
          if (matches(r, where)) return select ? pick(r, select) : r;
        }
        return null;
      },
      findUnique: async ({ where: { request_id } }: any) =>
        org_member_limit_requests.get(request_id) ?? null,
      update: async ({ where: { request_id }, data, select }: any) => {
        const row = org_member_limit_requests.get(request_id);
        Object.assign(row, data);
        return select ? pick(row, select) : row;
      },
    },
    site_admins: {
      findUnique: async ({ where: { admin_id } }: any) => site_admins.get(admin_id) ?? null,
    },
    admin_audit_log: {
      create: async ({ data }: any) => {
        admin_audit_log.push({ ...data });
        return data;
      },
    },
    $queryRaw: queryRaw,
    $transaction: async (cb: any) => cb(prisma),
  };

  return {
    prisma,
    organization,
    org_scope,
    org_members,
    member_roles,
    org_member_limit_requests,
    site_admins,
    admin_audit_log,
  };
}

/** Very small subset of Prisma's `where` matching — same shape as the Phase 6 integration spec's own helper. */
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('equals' in cond) return row[key] === cond.equals;
      if ('AND' in cond) return cond.AND.every((c: any) => matches(row, c));
      return false;
    }
    return row[key] === cond;
  });
}

function pick(row: any, select: Record<string, boolean>) {
  const out: any = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}
