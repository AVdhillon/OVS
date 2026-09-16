import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// EDIT (Phase 1 — auth model consolidation, subphase 1.3): generalized from
// a single hardcoded cookie pair to a list, so the same guard covers both
// the regular user session (`ovp_token`/`ovp_csrf`) and the new admin
// session (`ovp_admin_token`/`ovp_admin_csrf`, set by the SITEADMIN-backed
// route in auth.controller.ts) without needing a second, near-duplicate
// guard registered globally alongside this one.
const SESSION_COOKIE_PAIRS: Array<{ token: string; csrf: string }> = [
  { token: 'ovp_token', csrf: 'ovp_csrf' },
  { token: 'ovp_admin_token', csrf: 'ovp_admin_csrf' },
];

/**
 * Double-submit CSRF check (plan-httponly-cookie-jwt.md, Finding #2, step 6).
 *
 * Switching the JWT from a bearer header to an httpOnly cookie removes the
 * XSS-exfiltration risk on the token, but reintroduces CSRF: the browser
 * now attaches `ovp_token` automatically on any cross-site request, and a
 * bearer-in-header token (which a third-party page can't set) no longer
 * exists to make that impossible on its own.
 *
 * Mitigation: on login, the backend also sets a second, *non*-httpOnly
 * cookie (`ovp_csrf`) with a random value. The frontend reads it via
 * `document.cookie` and echoes it back as `X-CSRF-Token` on every mutating
 * request. A cross-site page can trigger the cookie to be sent, but it has
 * no way to read `ovp_csrf` to also set the header (same-origin policy), so
 * the two must match. The admin app (ovp_admin_token/ovp_admin_csrf) works
 * identically, just under its own cookie names.
 *
 * Registered globally (see app.module.ts) rather than per-controller so
 * every existing and future mutating route is covered without having to
 * remember to add it individually. It only enforces itself for requests
 * that are actually riding on a recognized session-token cookie —
 * non-GET requests with no session cookie at all have nothing for a
 * forged request to exploit, and are left for AuthGuard('jwt')/
 * SiteAdminGuard to reject on their own terms.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(req.method)) return true;

    // Check whichever session-cookie pair (if any) is actually present on
    // this request. A given request carries at most one of these in
    // practice (an ordinary session or an admin session), but the guard
    // doesn't need to assume that — it just validates whatever pair(s) it
    // finds a token cookie for.
    for (const pair of SESSION_COOKIE_PAIRS) {
      const sessionCookie = req.cookies?.[pair.token];
      if (!sessionCookie) continue;

      const cookieToken = req.cookies?.[pair.csrf];
      const headerToken = req.headers['x-csrf-token'];

      if (
        !cookieToken ||
        !headerToken ||
        typeof headerToken !== 'string' ||
        cookieToken !== headerToken
      ) {
        throw new ForbiddenException('Invalid or missing CSRF token');
      }
    }

    return true;
  }
}
