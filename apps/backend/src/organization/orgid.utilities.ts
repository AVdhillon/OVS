import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ─── Org ID allocation ────────────────────────────────────────────────────────
// EDIT (Phase 2 — org request staging, subphase 2.2): extracted wholesale out
// of org.service.ts's registerOrg(), where orgid generation, the cheap
// pre-check, and the TOCTOU retry-around-the-transaction loop were three
// separate stretches of code interleaved with participant parsing and the
// org-creation transaction body itself.
//
// Why extract it now: subphase 2.4's OrgRequestsService.approve() has to
// create an organization too, from an approved org_requests row, and needs
// exactly this behaviour — a unique orgid, allocated safely against concurrent
// creation. Copying the retry loop into a second service would mean two
// implementations of a race-condition fix (finding #8), which is the kind of
// thing that silently diverges. registerOrg() and approve() now share one.
//
// Behaviour is deliberately unchanged from registerOrg()'s original, with one
// bug fix called out under deriveOrgIdPrefix() below.

/** The format enforced by organization.chk_orgid_format in the schema. */
export const ORG_ID_FORMAT = /^[A-Z]{3}[0-9]{4}$/;

/**
 * What the caller knows about the orgid they want. All fields beyond orgName
 * are optional, which is what lets 2.4's approve() use this: an approved
 * org_requests row carries a name and nothing else, so it simply passes
 * `{ orgName }` and takes a fully generated ID.
 */
export interface OrgIdSpec {
  orgName: string;
  /** Caller-chosen exact ID (RegisterOrgDto.preferred_orgid). Never substituted. */
  preferredOrgId?: string | null;
  /** Caller-chosen 3-letter prefix (RegisterOrgDto.org_prefix). */
  prefix?: string | null;
  /** Caller-chosen 4-digit suffix (RegisterOrgDto.org_suffix). */
  suffix?: string | null;
}

/**
 * Derives the 3-letter prefix from an org name.
 *
 * FIX (found while extracting, subphase 2.2): the original inline version was
 * `orgName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()` with no
 * floor on the result. RegisterOrgDto only requires org_name to be 2–100
 * characters — it does not require letters — so a name like "42", "2024",
 * or one written in a non-Latin script strips down to fewer than 3 letters
 * and yields a malformed ID ("1234" instead of "ABC1234"). That violates
 * organization.chk_orgid_format, so the failure surfaced as a raw Postgres
 * check-constraint violation escaping as a 500 rather than anything the
 * caller could act on.
 *
 * This mattered little while registerOrg() was the only caller (org names
 * are usually Latin words), but 2.4's approve() derives the prefix from a
 * user-submitted org_requests.org_name with no org_prefix field available
 * to override it, so the unhappy path becomes reachable. Short/absent
 * letter runs are padded out with random letters instead.
 */
export function deriveOrgIdPrefix(orgName: string): string {
  const letters = orgName.replace(/[^A-Za-z]/g, '').toUpperCase();

  let prefix = letters.slice(0, 3);
  while (prefix.length < 3) {
    prefix += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  }

  return prefix;
}

/**
 * Builds a candidate orgid. Unchanged from registerOrg()'s original
 * generateOrgId() apart from the prefix derivation above.
 *
 * Note that `suffix` is honoured only when explicitly supplied. Regeneration
 * after a collision deliberately drops it (see runWithUniqueOrgId) — a fixed
 * suffix would otherwise regenerate the identical ID forever and burn every
 * retry attempt on the same losing value.
 */
export function generateOrgId(
  orgName: string,
  prefix?: string | null,
  suffix?: string | null,
): string {
  const p = prefix || deriveOrgIdPrefix(orgName);
  const s = suffix || String(Math.floor(1000 + Math.random() * 9000));
  return `${p}${s}`;
}

// FIX (finding #8): identifies a Prisma unique-constraint violation on
// organization.orgid specifically (as opposed to org_email or any other
// unique field that create() could also collide on), so the TOCTOU retry
// below only fires for the collision it's actually meant to handle.
export function isOrgIdUniqueConflict(err: unknown): boolean {  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const targetStr = Array.isArray(target)
    ? target.join(',')
    : String(target ?? '');
  return (
    targetStr.includes('orgid') ||
    targetStr.includes('organization_pkey') ||
    err.meta?.modelName === 'organization'
  );
}

/**
 * Picks the orgid to attempt first.
 *
 * FIX (finding #8): this stays as a cheap pre-check to reject an
 * obviously-taken preferred_orgid, or to steer the generator away from an
 * obvious collision, without paying for a transaction. It does NOT by itself
 * close the race — see runWithUniqueOrgId() below, which is what actually
 * handles two requests passing this check for the same orgid at the same time.
 */
export async function resolveInitialOrgId(
  prisma: PrismaService,
  spec: OrgIdSpec,
): Promise<{ orgid: string; isGenerated: boolean }> {
  const preferredOrgId = spec.preferredOrgId?.trim().toUpperCase();

  if (preferredOrgId) {
    const exists = await prisma.organization.findUnique({
      where: { orgid: preferredOrgId },
    });
    if (exists) {
      throw new ConflictException(
        `Organization ID "${preferredOrgId}" is already taken.`,
      );
    }
    return { orgid: preferredOrgId, isGenerated: false };
  }

  let orgid = generateOrgId(spec.orgName, spec.prefix, spec.suffix);

  for (let i = 0; i < 5; i++) {
    const exists = await prisma.organization.findUnique({ where: { orgid } });
    if (!exists) break;
    orgid = generateOrgId(spec.orgName, spec.prefix);
    if (i === 4) {
      throw new ConflictException(
        'Could not generate unique org ID. Try again.',
      );
    }
  }

  return { orgid, isGenerated: true };
}

/**
 * Read-only "is this orgid free" check — no allocation, no retry loop,
 * just the existence lookup. Deliberately separate from
 * resolveInitialOrgId() above: that function is the pre-check *inside* an
 * actual creation attempt (registerOrg()/finalizeSetup()), reused here only
 * for the query it already runs.
 *
 * EDIT (Phase 6 — post-approval org finalization, subphase 6.5): extracted
 * so GET /org/orgid-available (org.controller.ts) can offer a live-typing
 * availability check in the finalize-setup wizard without going through
 * resolveInitialOrgId()'s "trim/uppercase a preferred_orgid, or generate one
 * from an org name" branching, which doesn't fit this endpoint's shape (this
 * always checks one caller-supplied, already-validated orgid — no
 * generation branch, no orgName). Same caveat as resolveInitialOrgId()'s own
 * comment: this only reduces collision probability for the caller's next
 * real attempt, it doesn't reserve the ID — runWithUniqueOrgId() at actual
 * creation time is still what closes the race.
 */
export async function isOrgIdAvailable(
  prisma: PrismaService,
  orgid: string,
): Promise<boolean> {
  const exists = await prisma.organization.findUnique({
    where: { orgid },
    select: { orgid: true },
  });
  return !exists;
}

/**
 * Allocates a unique orgid and runs `body` inside a transaction with it,
 * retrying the whole transaction on an orgid collision.
 *
 * FIX (finding #8 — TOCTOU race): the findUnique() checks in
 * resolveInitialOrgId() only reduce the *probability* of a collision, they
 * don't prevent one. Two concurrent registrations can both pass the check for
 * the same orgid before either has inserted it, then race to insert inside
 * the body's organization.create(). The orgid PRIMARY KEY is what actually
 * prevents the duplicate — so the loser previously failed with a raw Prisma
 * P2002 unique-violation propagating out to whatever generic handling caught
 * it, rather than a clean, specific 409.
 *
 * The retry behaviour differs by how orgid was chosen:
 *   - preferred_orgid (caller-chosen): don't retry with a different ID —
 *     silently substituting an ID the caller didn't ask for would be
 *     surprising. Report the conflict directly.
 *   - auto-generated: the collision is just an unlucky random clash between
 *     two concurrent signups, not a meaningful conflict for this caller.
 *     Regenerate and retry the whole transaction rather than failing their
 *     registration on bad timing.
 *
 * `body` must be idempotent-by-retry in the sense that it may run more than
 * once — which it is, because every attempt is its own transaction and a
 * failed attempt rolls back entirely before the next one starts. It receives
 * the orgid for the current attempt as an argument rather than closing over
 * it, so a retry can't accidentally write the previous, losing ID.
 */
export async function runWithUniqueOrgId<T>(
  prisma: PrismaService,
  spec: OrgIdSpec,
  body: (tx: Prisma.TransactionClient, orgid: string) => Promise<T>,
): Promise<{ orgid: string; result: T }> {
  const { orgid: initialOrgId, isGenerated } = await resolveInitialOrgId(
    prisma,
    spec,
  );

  let orgid = initialOrgId;
  const maxAttempts = isGenerated ? 3 : 1;

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await prisma.$transaction((tx) => body(tx, orgid));
      return { orgid, result };
    } catch (err) {
      if (!isOrgIdUniqueConflict(err)) throw err;

      if (!isGenerated || attempt >= maxAttempts) {
        throw new ConflictException(
          `Organization ID "${orgid}" is already taken.`,
        );
      }
      // Lost the race on a random ID — pick a fresh one and try again.
      orgid = generateOrgId(spec.orgName, spec.prefix);
    }
  }
}
