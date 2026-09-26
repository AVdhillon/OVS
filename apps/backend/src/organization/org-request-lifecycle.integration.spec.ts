import { Test, TestingModule } from '@nestjs/testing';
import { OrgRequestsService } from './org-requests.service';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { OrgRequestEmailService } from './org-request-email.service';
import { SubmitOrgRequestDto } from './dto/submit-org-request.dto';
import { ApproveOrgRequestDto } from './dto/review-org-request.dto';
import { FinalizeOrgRequestDto } from './dto/finalize-org-request.dto';
import { AddMembersDto } from './dto/add-members.dto';

// ─── Integration: submit → approve → finalize → org exists → member limit
// enforced (Phase 6, subphase 6.7) ──────────────────────────────────────────
//
// post-approval-org-setup-plan.md's 6.7 section calls for exactly this: a
// full submit → approve → finalize → org-exists → member-limit-enforced run.
//
// What this test IS: the real OrgRequestsService/OrgService code for
// submit(), approve(), finalizeSetup() and addMembers() run end to end
// against a small in-memory fake standing in for PrismaService — including
// the real runWithUniqueOrgId()/createOrganizationCore() helpers underneath
// finalizeSetup(), unmocked. It genuinely exercises the sequencing this
// phase introduced: an org_requests row that can't skip
// APPROVED_PENDING_SETUP, an organization row that doesn't exist until
// finalizeSetup() creates it with the admin-set member_limit baked in at
// INSERT time, and addMembers()'s own running-counter pre-check refusing an
// add once that limit is reached.
//
// What this test is NOT: a substitute for running this against a real
// Postgres instance. `trg_check_member_limit` (dbschema.sql, 6.4) is a DB
// trigger — there is no SQL engine here to execute it — so this test can
// only prove the *service-level* pre-check in addMembers() (org.service.ts)
// refuses the over-limit add. The DB trigger is the actual backstop for a
// concurrent request racing past that pre-check (see 6.4's own notes on the
// division of labor); it needs its own verification against a live database
// with dbschema.sql loaded, which this sandbox cannot run (no network path
// to provision one here — see PROGRESS.md's 6.3/6.4 notes on the same
// limitation for `npx prisma generate`).
//
// OTP verification (org-email domain ownership, 4.3) and outbound email
// (org-request-email.service.ts, 4.5) are stubbed rather than faked in
// full — they're side flows this phase doesn't touch, already exercised by
// submit()'s and approve()'s own areas of the codebase.

describe('org request lifecycle -> member limit enforcement (integration)', () => {
  let orgRequestsService: OrgRequestsService;
  let orgService: OrgService;
  let db: ReturnType<typeof createFakeOrgDb>;

  const pid = 100n;
  const adminId = 'ADMIN01';

  beforeEach(async () => {
    db = createFakeOrgDb();
    db.uaccount.set(pid, {
      pid,
      email: 'founder@example.com',
      mobile: null,
      created_at: new Date('2020-01-01'), // old account -> no risk flag noise
    });
    db.site_admins.set(adminId, { admin_id: adminId, is_active: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgRequestsService,
        OrgService,
        { provide: PrismaService, useValue: db.prisma },
        {
          provide: OtpService,
          useValue: { verifyOtp: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: OrgRequestEmailService,
          useValue: {
            sendRequestReceived: jest.fn().mockResolvedValue(undefined),
            sendApprovedPendingSetup: jest.fn().mockResolvedValue(undefined),
            sendApproved: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    orgRequestsService = module.get(OrgRequestsService);
    orgService = module.get(OrgService);
  });

  it('carries a 2-member org from submission through to its cap being enforced', async () => {
    // ── 1. submit() ──────────────────────────────────────────────────────
    const submitDto: SubmitOrgRequestDto = {
      org_name: 'Riverside Rowing Club',
      org_email: 'contact@riverside.example',
      org_email_otp: '000000', // OtpService is stubbed to accept anything
      expected_member_count: 2,
    };
    const submitted = await orgRequestsService.submit(pid, submitDto);
    expect(submitted.status).toBe('PENDING');

    const requestId = BigInt(submitted.request_id as any);
    expect(db.org_requests.get(requestId)?.status).toBe('PENDING');

    // ── 2. approve() with a member cap of 2 ─────────────────────────────
    const approveDto: ApproveOrgRequestDto = { member_limit: 2 };
    const approved = await orgRequestsService.approve(
      requestId,
      adminId,
      approveDto,
    );
    expect(approved.status).toBe('APPROVED_PENDING_SETUP');
    expect(db.org_requests.get(requestId)?.admin_set_member_limit).toBe(2);
    // No organization exists yet — that's the whole point of 6.2's split.
    expect(db.organization.size).toBe(0);

    // ── 3. finalizeSetup() — the requester actually creates the org ────
    const finalizeDto: FinalizeOrgRequestDto = {
      orgid_choice: { mode: 'generate' },
      org_email: 'contact@riverside.example', // unchanged -> no re-verify
      owner_uid: 'FOUNDER1',
    };
    const finalized = await orgRequestsService.finalizeSetup(
      requestId,
      pid,
      finalizeDto,
    );
    expect(finalized.status).toBe('APPROVED');
    const orgid = finalized.orgid;

    // Org now exists, with the admin-set cap carried onto it at INSERT time.
    const org = db.organization.get(orgid);
    expect(org).toBeDefined();
    expect(org!.member_limit).toBe(2);
    // Owner was seeded as the org's first (organizer) member.
    expect(db.org_members.get(`${orgid}:FOUNDER1`)?.is_deleted).toBe(false);
    expect(db.org_requests.get(requestId)?.status).toBe('APPROVED');
    expect(db.org_requests.get(requestId)?.approved_orgid).toBe(orgid);

    // ── 4. addMembers() — first addition succeeds (owner + 1 = 2, at cap) ─
    const secondMember: AddMembersDto = {
      participants: [
        {
          uid: 'MEMBER01',
          participant_identifier: 'member01@example.com',
          role: 'v',
        } as any,
      ],
    };
    const firstAdd = await orgService.addMembers(
      pid,
      orgid,
      'FOUNDER1',
      secondMember,
    );
    expect(firstAdd.results).toEqual([{ uid: 'MEMBER01', status: 'added' }]);
    expect(
      await countActiveMembers(db, orgid),
    ).toBe(2);

    // ── 5. addMembers() — the org is now at its cap; the next add is
    // refused by addMembers()'s own service-level pre-check, with a clean
    // per-row error rather than a raw DB exception. ─────────────────────
    const thirdMember: AddMembersDto = {
      participants: [
        {
          uid: 'MEMBER02',
          participant_identifier: 'member02@example.com',
          role: 'v',
        } as any,
      ],
    };
    const secondAdd = await orgService.addMembers(
      pid,
      orgid,
      'FOUNDER1',
      thirdMember,
    );
    expect(secondAdd.results).toEqual([
      {
        uid: 'MEMBER02',
        status: 'error',
        error: 'Organization has reached its member limit of 2',
      },
    ]);
    // The refused member was never actually written.
    expect(db.org_members.has(`${orgid}:MEMBER02`)).toBe(false);
    expect(await countActiveMembers(db, orgid)).toBe(2);
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
// Implements only the tables/methods actually reached by submit(), approve(),
// finalizeSetup(), createOrganizationCore(), runWithUniqueOrgId(),
// addMembers(), assertOrganizerAccess(), getCallerOrganizerScopes() and
// getDescendantScopeIds() — not a general Prisma stand-in. $transaction runs
// its callback against the same store synchronously (this test has no
// concurrent callers, so no isolation/rollback semantics are needed).
function createFakeOrgDb() {
  const uaccount = new Map<bigint, any>();
  const site_admins = new Map<string, any>();
  const org_requests = new Map<bigint, any>();
  const organization = new Map<string, any>();
  const org_scope = new Map<number, any>();
  const org_members = new Map<string, any>();
  const member_roles = new Map<string, any>();
  const admin_audit_log: any[] = [];
  const identity_wallet: any[] = [];

  let nextRequestId = 1n;
  let nextScopeId = 1;

  function memberKey(orgid: string, uid: string) {
    return `${orgid}:${uid}`;
  }
  function roleKey(orgid: string, uid: string, scope_id: number) {
    return `${orgid}:${uid}:${scope_id}`;
  }

  // Routes a tagged-template $queryRaw call by sniffing the SQL text — the
  // real service code only ever issues a handful of distinct raw queries,
  // each identifiable by a substring.
  function queryRaw(strings: TemplateStringsArray, ...values: any[]) {
    const sql = strings.join('?');
    if (sql.includes('similarity(')) {
      // findClosestOrgNameMatch() — no seeded orgs share this test's name,
      // so "no match" (empty result) is the correct, realistic answer.
      return Promise.resolve([]);
    }
    if (sql.includes('get_scope_descendants')) {
      // This test's org has only its auto-created ROOT scope — descendants
      // of any scope_id here is just itself.
      const scopeId = values[0];
      return Promise.resolve([{ scope_id: scopeId }]);
    }
    if (sql.includes('FROM org_requests') && sql.includes('FOR UPDATE')) {
      const requestId = values[0] as bigint;
      const row = org_requests.get(requestId);
      return Promise.resolve(row ? [{ ...row }] : []);
    }
    throw new Error(`fake $queryRaw: unrecognised query: ${sql}`);
  }

  const prisma: any = {
    uaccount: {
      findUnique: async ({ where: { pid } }: any) =>
        uaccount.get(pid) ?? null,
    },
    site_admins: {
      findUnique: async ({ where: { admin_id } }: any) =>
        site_admins.get(admin_id) ?? null,
    },
    org_requests: {
      create: async ({ data, select }: any) => {
        const request_id = nextRequestId++;
        const row = {
          request_id,
          reference_code: `ORQ-${String(request_id).padStart(7, '0')}`,
          status: 'PENDING',
          created_at: new Date(),
          admin_set_member_limit: null,
          approved_orgid: null,
          setup_completed_at: null,
          ...data,
        };
        org_requests.set(request_id, row);
        return select ? pick(row, select) : row;
      },
      findUnique: async ({ where: { request_id } }: any) =>
        org_requests.get(request_id) ?? null,
      findFirst: async ({ where, orderBy, select }: any) => {
        let rows = [...org_requests.values()].filter((r) =>
          matches(r, where),
        );
        if (orderBy?.created_at === 'desc') {
          rows = rows.sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime(),
          );
        }
        const row = rows[0];
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
      update: async ({ where: { request_id }, data, select }: any) => {
        const row = org_requests.get(request_id);
        Object.assign(row, data);
        return select ? pick(row, select) : row;
      },
    },
    organization: {
      findUnique: async ({ where: { orgid }, select }: any) => {
        const row = organization.get(orgid);
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
      create: async ({ data }: any) => {
        const row = { is_deleted: false, ...data };
        organization.set(row.orgid, row);
        // Mirrors the DB trigger that auto-creates a ROOT org_scope row
        // whenever an organization is inserted.
        const scope_id = nextScopeId++;
        org_scope.set(scope_id, {
          scope_id,
          orgid: row.orgid,
          parent_scope_id: null,
          scope_name: 'ROOT',
        });
        return row;
      },
    },
    org_scope: {
      findFirst: async ({ where }: any) => {
        for (const s of org_scope.values()) {
          if (matches(s, where)) return s;
        }
        return null;
      },
    },
    org_members: {
      findUnique: async ({ where: { orgid_uid } }: any) =>
        org_members.get(memberKey(orgid_uid.orgid, orgid_uid.uid)) ?? null,
      create: async ({ data }: any) => {
        const row = { is_deleted: false, ...data };
        org_members.set(memberKey(row.orgid, row.uid), row);
        return row;
      },
      update: async ({ where: { orgid_uid }, data }: any) => {
        const row = org_members.get(
          memberKey(orgid_uid.orgid, orgid_uid.uid),
        );
        Object.assign(row, data);
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
        const rows = [...member_roles.values()].filter((r) =>
          matches(r, where),
        );
        return select ? rows.map((r) => pick(r, select)) : rows;
      },
      count: async ({ where }: any) => {
        let n = 0;
        for (const r of member_roles.values()) if (matches(r, where)) n++;
        return n;
      },
    },
    identity_wallet: {
      create: async ({ data }: any) => {
        identity_wallet.push({ ...data });
        return data;
      },
    },
    admin_audit_log: {
      create: async ({ data }: any) => {
        admin_audit_log.push({ ...data });
        return data;
      },
    },
    $executeRaw: async () => 0,
    $queryRaw: queryRaw,
    $transaction: async (cb: any) => cb(prisma),
  };

  return {
    prisma,
    uaccount,
    site_admins,
    org_requests,
    organization,
    org_scope,
    org_members,
    member_roles,
    admin_audit_log,
    identity_wallet,
  };
}

/** Very small subset of Prisma's `where` matching — equality and `{ in: [...] }`/`{ equals, mode }` only, which is all this file's queries use. */
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('equals' in cond) {
        if (cond.mode === 'insensitive') {
          return (
            String(row[key]).toLowerCase() ===
            String(cond.equals).toLowerCase()
          );
        }
        return row[key] === cond.equals;
      }
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
