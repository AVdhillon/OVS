// src/common/decorators/require-super-admin.decorator.ts
//
// EDIT (Phase 1 — auth model consolidation, subphase 1.3): new. Mirrors
// require-organizer.decorator.ts's SetMetadata pattern.
//
// Marks a route as requiring the elevated `site_admins.is_super_admin`
// tier, on top of the ordinary SiteAdminGuard authentication check. Works
// together with SiteAdminGuard, which reads this metadata via Reflector
// and checks it against `req.user.is_super_admin` (set on the JWT payload
// by AuthService.siteAdminLogin() — see auth.service.ts, subphase 1.2)
// after passport's 'site-admin-jwt' strategy has already authenticated the
// caller as *some* site admin.
//
// A route with @UseGuards(SiteAdminGuard) but no @RequireSuperAdmin() is
// reachable by any active site admin. Adding @RequireSuperAdmin() narrows
// that to super admins only — e.g. the admin-account-management endpoints
// in Phase 5 (invite/deactivate other admins) are expected to use this.

import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_KEY = 'require_super_admin';

/**
 * Marks a route as requiring `is_super_admin` on top of a valid SITEADMIN
 * session. Must be combined with `@UseGuards(SiteAdminGuard)` — this
 * decorator only sets metadata; SiteAdminGuard is what reads it.
 */
export const RequireSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true);
