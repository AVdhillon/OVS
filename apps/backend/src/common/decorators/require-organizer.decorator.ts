// src/common/decorators/require-organizer.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const ORGANIZER_KEY = 'require_organizer';

/**
 * Marks a route as requiring organizer role in the resolved org.
 * Works together with RolesGuard.
 *
 * @param orgidParam  name of the route param that holds the orgid (default: 'orgid')
 */
export const RequireOrganizer = (orgidParam = 'orgid') =>
  SetMetadata(ORGANIZER_KEY, { orgidParam });