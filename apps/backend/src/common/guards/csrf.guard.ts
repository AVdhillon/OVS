import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
 * the two must match.
 *
 * Registered globally (see app.module.ts) rather than per-controller so
 * every existing and future mutating route is covered without having to
 * remember to add it individually. It only enforces itself for requests
 * that are actually riding on the `ovp_token` cookie — non-GET requests
 * with no session cookie at all have nothing for a forged request to
 * exploit, and are left for `AuthGuard('jwt')` to reject on its own terms.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(req.method)) return true;

    const sessionCookie = req.cookies?.['ovp_token'];
    if (!sessionCookie) return true;

    const cookieToken = req.cookies?.['ovp_csrf'];
    const headerToken = req.headers['x-csrf-token'];

    if (
      !cookieToken ||
      !headerToken ||
      typeof headerToken !== 'string' ||
      cookieToken !== headerToken
    ) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }

    return true;
  }
}
