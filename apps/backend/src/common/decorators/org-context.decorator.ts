// src/common/decorators/org-context.decorator.ts

import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export interface OrgContext {
  orgid: string;
  uid: string;
}

/**
 * @OrgCtx() ctx: OrgContext
 *
 * Resolves orgid + uid from (in priority order):
 *   1. req.user  (when user is logged in via ORG identity)
 *   2. route params  (/orgs/:orgid/members/:uid)
 *   3. request body  ({ orgid, uid })
 *
 * Throws BadRequestException if neither can be resolved.
 */
export const OrgCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    // 1. Prefer JWT payload (most trusted)
    if (user?.type === 'ORG' && user.orgid && user.uid) {
      return { orgid: user.orgid, uid: user.uid };
    }

    // 2. Route params
    const orgid = req.params?.orgid ?? req.body?.orgid;
    const uid   = req.params?.uid   ?? req.body?.uid;

    if (orgid && uid) {
      return { orgid, uid };
    }

    throw new BadRequestException('Could not resolve org context (orgid/uid missing)');
  },
);