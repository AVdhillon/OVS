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

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Read metadata set by @RequireOrganizer()
    const meta = this.reflector.getAllAndOverride<{ orgidParam: string } | undefined>(
      ORGANIZER_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // If no @RequireOrganizer() on this route, skip guard
    if (!meta) return true;

    const req  = ctx.switchToHttp().getRequest();
    const user = req.user;
    console.log(user);
    // Resolve orgid: from JWT payload first, then route param
    const orgid: string =
      user?.orgid ?? req.params?.[meta.orgidParam] ?? req.body?.[meta.orgidParam];

    // Resolve uid: from JWT payload first, then route param / body
    const uid: string = user?.uid ?? req.params?.uid ?? req.query?.uid ?? req.body?.uid;

    if (!orgid || !uid) {
      throw new ForbiddenException('org context required to check organizer role');
    }

    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid },
      select: { is_organizer: true },
    });

    if (!role?.is_organizer) {
      throw new ForbiddenException('Organizer role required');
    }

    // Attach resolved context to request for downstream use
    req.orgContext = { orgid, uid };

    return true;
  }
}