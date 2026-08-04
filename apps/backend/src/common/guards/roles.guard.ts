// src/common/guards/roles.guard.ts

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { ORGANIZER_KEY } from '../decorators/require-organizer.decorator';
import { OrgService } from '../../organization/org.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private orgService: OrgService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Read metadata set by @RequireOrganizer()
    const meta = this.reflector.getAllAndOverride<
      { orgidParam: string } | undefined
    >(ORGANIZER_KEY, [ctx.getHandler(), ctx.getClass()]);

    // If no @RequireOrganizer() on this route, skip guard
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    // Resolve orgid: from JWT payload first, then route param
    const orgid: string =
      user?.orgid ??
      req.params?.[meta.orgidParam] ??
      req.body?.[meta.orgidParam];

    if (!orgid) {
      throw new ForbiddenException(
        'org context required to check organizer role',
      );
    }

    // Resolve the uid the caller is actually allowed to act as. For UNIFIED
    // sessions this is verified against org_members.pid — never trusted
    // blindly from a header/query/body value.
    const requestedUid =
      req.headers?.['x-caller-uid'] ?? req.query?.uid ?? req.body?.uid;
    const uid = await this.orgService.resolveCallerUid(
      user,
      orgid,
      requestedUid,
    );

    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid, is_organizer: true },
    });
    if (!role) {
      throw new ForbiddenException('Organizer role required');
    }

    // Attach resolved context to request for downstream use — controller
    // methods should read req.orgContext.uid rather than re-resolving it.
    req.orgContext = { orgid, uid };

    return true;
  }
}
