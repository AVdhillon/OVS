// src/common/decorators/require-scope.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const SCOPE_KEY = 'require_scope';

/**
 * Marks a route as requiring scope access.
 *
 * @param targetScopeParam  name of the route param / body field that holds the
 *                          target scope_id the caller must be able to reach.
 *                          Default: 'scope_id'
 */
export const RequireScope = (targetScopeParam = 'scope_id') =>
  SetMetadata(SCOPE_KEY, { targetScopeParam });