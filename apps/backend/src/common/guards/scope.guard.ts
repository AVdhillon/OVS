// src/common/guards/scope.guard.ts

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { SCOPE_KEY } from '../decorators/require-scope.decorator';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ targetScopeParam: string } | undefined>(
      SCOPE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!meta) return true;

    const req  = ctx.switchToHttp().getRequest();
    const user = req.user;

    // ── Resolve orgid + uid ──────────────────────────────────────────────────
    const orgid: string =
      user?.orgid ?? req.params?.orgid ?? req.body?.orgid;
    const uid: string =
      user?.uid ?? req.params?.uid ?? req.body?.uid;

    if (!orgid || !uid) {
      throw new ForbiddenException('Org context required for scope check');
    }

    // ── Resolve caller's scope ───────────────────────────────────────────────
    const role = await this.prisma.member_roles.findFirst({
      where: { orgid, uid },
      select: { scope_id: true },
    });

    if (!role) {
      throw new ForbiddenException('Member role not found');
    }

    const callerScope = role.scope_id;

    // ── Resolve target scope from param or body ──────────────────────────────
    const rawTarget =
      req.params?.[meta.targetScopeParam] ??
      req.body?.[meta.targetScopeParam];

    if (rawTarget === undefined || rawTarget === null) {
      throw new ForbiddenException(`Target scope param "${meta.targetScopeParam}" missing`);
    }

    const targetScope = Number(rawTarget);

    // ── Check: is targetScope a descendant-or-equal of callerScope? ──────────
    // Uses the DB function get_scope_descendants defined in the schema
    const descendants: { scope_id: number }[] = await this.prisma.$queryRaw`
      SELECT scope_id FROM get_scope_descendants(${callerScope}::int)
    `;

    const allowed = descendants.some((r) => r.scope_id === targetScope);

    if (!allowed) {
      throw new ForbiddenException('Scope access denied — target scope is outside your tree');
    }

    // Attach for downstream use
    req.scopeContext = { callerScope, targetScope, orgid, uid };

    return true;
  }
}