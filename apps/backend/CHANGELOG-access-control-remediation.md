# OVS Access Control Remediation — Changelog

Summary of all changes made across Phases 1–5 of the access-control
remediation, file by file. Backend paths are relative to `backend/`,
frontend paths relative to `frontend/`.

## Phase 1 — JWT secret + log hygiene
- `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.module.ts`: removed
  the `|| 'SECRET_KEY'` hardcoded fallback; signing secret now resolved via
  `src/common/utils/jwt-secret.util.ts`, which throws at boot in production
  if `JWT_SECRET` is unset (falls back to a clearly-labelled insecure dev
  value with a console warning outside production).
- `src/auth/auth.service.ts`: removed `console.log(dto)` (was logging raw
  login payload including OTP).
- `src/auth/strategies/jwt.strategy.ts`: removed stray `console.log('here')`.
- `README.md`: documented `JWT_SECRET` and `VOTER_HASH_SALT` as required,
  no-safe-default env vars.

## Phase 2a — Events cross-org IDOR (core fix)
- `src/events/events.service.ts`: replaced the no-op `assertOrgIdentity()`
  (UNIFIED sessions were never actually checked) with
  `resolveCallerIdentityInOrg()` / `assertCallerOwnsEvent()`, which resolve
  the caller's real org+uid via `OrgService.resolveCallerUid()` (pid →
  `org_members`) before allowing `updateEvent()`/`deleteEvent()` to mutate
  an event — event is loaded first, then ownership is checked against the
  loaded event's actual `orgid`/`created_by_uid`, not the trusted route
  param.
- `src/events/events.service.spec.ts`: added cross-org UNIFIED-organizer
  rejection tests + same-org regression tests for update/delete.

## Phase 2b — Events cross-org IDOR (participants + createEvent)
- `src/events/events.service.ts`: `getParticipants()` no longer hard-blocks
  non-ORG sessions; uses the same `resolveCallerIdentityInOrg()` pattern.
  Verified `createEvent()`'s `member_roles` check is the real gate and is
  safe for both session types post-Phase-2a.
- `src/events/events.service.spec.ts`: added participants cross-org
  rejection + same-org tests, and a `createEvent()` verification test.

## Phase 3 — ScopeGuard / OrgCtx dead code
- Deleted `src/common/guards/scope.guard.ts`,
  `src/common/decorators/require-scope.decorator.ts`, and the dead
  `IsEmailOrPhone`/`OrgCtx` code in `org-context.decorator.ts` — unused,
  and resolved `uid` straight from `req.body`/`req.params` with no
  ownership check (same class of bug as Phase 2, but inert since nothing
  wired it up).
- `src/common/common.module.ts`: removed `ScopeGuard` provider/export,
  left an explanatory comment for why and what to do if scope-guarding is
  needed again.

## Phase 4 — Hardening & cleanup
- `src/main.ts`: added `VERCEL_PREVIEW_PREFIX` env var to scope the
  Vercel-preview CORS allowance to a specific project prefix instead of
  trusting any `*.vercel.app` origin; logs a production warning when unset
  (falls back to the old broad behavior). `ALLOWED_ORIGINS` production
  enforcement was already in place — confirmed only.
- `README.md` (backend): documented `VERCEL_PREVIEW_PREFIX`, updated the
  `ALLOWED_ORIGINS` row.
- Audited all `$queryRaw`/`$executeRaw` call sites (`events.service.ts`,
  `org.service.ts`, `voting.service.ts`) — all use Prisma tagged-template
  literals; no string concatenation, no `$queryRawUnsafe`/`Prisma.raw`
  usage found anywhere.
- `src/app/context/app-context.tsx` (frontend): consolidated the
  duplicated JWT-decode/`setSession` block in the mount `useEffect` down to
  a single decode.
- `README.md` (frontend): added a "Security notes" section documenting the
  `localStorage` JWT storage tradeoff (XSS exposure) and scoping the
  httpOnly-cookie + CSRF migration as its own follow-up.
- `src/app/pages/dashboard-layout.tsx` (frontend): added `hiddenFor` to nav
  item configs and a `getVisibleNavItems()` filter so GOV sessions don't
  see "Manage Events"/"Organizations" in the sidebar. UX-only — backend
  enforcement unchanged.

## Phase 5 — Regression pass
- **Found and fixed a real regression** introduced by the route shape (not
  by any specific phase's diff, but only surfaced now): `DELETE
  /events/:eventId` had `@UseGuards(RolesGuard)` +
  `@RequireOrganizer('orgid')`, but the route has no `:orgid` param and
  DELETE requests carry no body — so `RolesGuard`'s orgid resolution
  (`user?.orgid ?? req.params?.orgid ?? req.body?.orgid`) could only ever
  succeed for ORG sessions (whose JWT carries `orgid`). For UNIFIED
  sessions `user.orgid` is undefined, so the guard threw "org context
  required" and **blocked every legitimate UNIFIED-organizer delete**
  before the request ever reached the service — silently violating Phase
  2a's own acceptance criterion ("UNIFIED organizer of org A updating/
  deleting their own org's event → still works"). Same root cause as the
  bug Phase 2b fixed for `getParticipants`.
  - Fix: removed `@UseGuards(RolesGuard)`/`@RequireOrganizer('orgid')` from
    the DELETE route in `src/events/events.controller.ts`. Authorization
    now lives entirely in `EventsService.deleteEvent()` via
    `assertCallerOwnsEvent()`, which does full org-identity resolution
    (Phase 2a) and a **stricter** creator-only check than the guard ever
    performed — so this is not a weakening, it's removing a redundant and
    broken pre-check.
  - Added `src/events/events.controller.spec.ts` test asserting
    `deleteEvent` carries neither the `RolesGuard` guard nor
    `@RequireOrganizer` metadata, so the regression can't silently return.
- **Found and fixed a Jest config gap**: `roles.guard.ts` and
  `jwt.strategy.ts` import `PrismaService` via the bare specifier
  `'src/prisma/prisma.service'` (relying on `tsconfig.json`'s
  `baseUrl: "./"`). Jest's own module resolver doesn't honor TS
  `baseUrl` by default, so any spec transitively importing either file
  failed with `Cannot find module 'src/prisma/prisma.service'` — a false
  negative unrelated to any actual code issue, masking real test results.
  - Fix: added `"modulePaths": ["<rootDir>/.."]` to the `jest` config in
    `package.json`, so bare `src/...` imports resolve the same way under
    Jest as they do under `tsc`.
- Walked all three login flows (UNIFIED, ORG, GOV) in
  `src/auth/auth.service.ts` / `jwt.strategy.ts` end-to-end: token payload
  shape, prior-session deactivation (`user_sessions.updateMany`), new
  session creation, and `jwt.strategy.ts`'s per-request session/expiry
  check all match up correctly for every session type — no regressions
  found. JWT's own 1h `expiresIn` (`auth.module.ts`) matches the DB
  session's 1h `expires_at`.
- Walked the event lifecycle for both UNIFIED-organizer and ORG-session
  organizer (create → update → view participants → delete) — confirmed
  correct end-to-end aside from the DELETE-route bug above, now fixed.
- Walked the vote-casting flow (`VotingService.castVote()`): confirmed it
  resolves the caller's `org_members` row directly from the JWT's own
  `pid`/`orgid`/`uid` (never trusting a client-supplied uid), independent
  of `OrgService.resolveCallerUid()` and the guards touched in Phases 2–3
  — so it was never exposed to that class of bug and Phases 2/3 did not
  regress it.

### Known environment limitation (this sandbox only)
This container has no network access to `binaries.prisma.sh` (not on the
egress allowlist), so `prisma generate` cannot complete here, which means
13 of 15 backend Jest suites can only be confirmed by static/manual review
in this environment, not by an actual test run. **Before treating this
remediation as fully verified, run locally:**

```bash
cd backend
npm install
npx prisma generate
npm test
```

Everything in this changelog was verified either by an actual passing test
run (the 2 suites — `app.controller.spec.ts`, `otp.controller.spec.ts` —
that don't transitively depend on the generated Prisma client), by
`tsc --noEmit` (zero errors introduced in any file touched this phase, on
both backend and frontend), or by careful manual code-path review.

### Pre-existing, out-of-scope items noticed but not touched
- Frontend `tsc --noEmit` surfaces several pre-existing type errors
  unrelated to any phase of this remediation (missing `@types/react-dom`,
  a `lodash` type-decl gap via `recharts`, a few `RefObject` nullability
  mismatches in `auth-page.tsx`, `manage-events-view.tsx`,
  `normalizeEvent.ts`, and a missing prop on `OTPVerificationModalProps` in
  `identity-wallet-view.tsx`). None of these are in files this remediation
  touched; left alone to keep this changeset scoped to access control.
- `VotingService.castVote()`'s UNIFIED-session member lookup uses
  `findFirst()` against `org_members` filtered by `orgid` + `pid`; if a
  single `pid` ever holds multiple `uid`s in the same org, it silently
  picks one rather than requiring disambiguation (unlike
  `OrgService.resolveCallerUid()`, which explicitly rejects that case).
  Not a security regression — it can't be steered by the caller — but
  worth a look if that data shape is possible in practice.
