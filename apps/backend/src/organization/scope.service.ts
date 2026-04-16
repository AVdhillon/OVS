import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScopeDto, UpdateScopeDto } from './dto/scope.dto';
import { OrgService } from './org.service';

export interface ScopeNode {
  scope_id: number;
  scope_name: string;
  parent_scope_id: number | null;
  children: ScopeNode[];
}

@Injectable()
export class ScopeService {
  constructor(
    private prisma: PrismaService,
    private orgService: OrgService,
  ) {}

  // ─── Get full scope tree for the org (caller sees only own subtree) ─────────
  async getScopeTree(orgid: string, callerUid: string): Promise<ScopeNode[]> {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes =
      await this.orgService.getCallerOrganizerScopes(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    const allScopes = await this.prisma.org_scope.findMany({
      where: { orgid, scope_id: { in: visibleIds } },
      select: { scope_id: true, scope_name: true, parent_scope_id: true },
      orderBy: { scope_id: 'asc' },
    });

    // Build a forest rooted at every organizer scope the caller holds
    return buildForest(allScopes, callerOrganizerScopes);
  }

  // ─── Add scope node ──────────────────────────────────────────────────────────
  async createScope(orgid: string, callerUid: string, dto: CreateScopeDto) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes =
      await this.orgService.getCallerOrganizerScopes(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    // Default parent: first organizer scope of the caller
    const parentId = dto.parent_scope_id ?? callerOrganizerScopes[0];

    if (!visibleIds.includes(parentId)) {
      throw new ForbiddenException('Cannot create scope outside your subtree');
    }

    const conflict = await this.prisma.org_scope.findFirst({
      where: { orgid, parent_scope_id: parentId, scope_name: dto.scope_name },
    });
    if (conflict)
      throw new BadRequestException(
        'A scope with this name already exists at that level',
      );

    const created = await this.prisma.org_scope.create({
      data: { orgid, scope_name: dto.scope_name, parent_scope_id: parentId },
    });

    return created;
  }

  // ─── Rename scope node ───────────────────────────────────────────────────────
  async updateScope(
    orgid: string,
    callerUid: string,
    scopeId: number,
    dto: UpdateScopeDto,
  ) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes =
      await this.orgService.getCallerOrganizerScopes(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    if (!visibleIds.includes(scopeId)) {
      throw new ForbiddenException('Cannot edit a scope outside your subtree');
    }

    const node = await this.prisma.org_scope.findUnique({
      where: { scope_id: scopeId },
    });
    if (!node) throw new NotFoundException('Scope node not found');

    if (node.parent_scope_id === null) {
      throw new BadRequestException('Cannot rename the ROOT scope');
    }

    if (!dto.scope_name) {
      throw new BadRequestException(
        'scope_name is required to rename a scope node',
      );
    }

    // Ensure uniqueness within the same parent
    const conflict = await this.prisma.org_scope.findFirst({
      where: {
        orgid,
        parent_scope_id: node.parent_scope_id,
        scope_name: dto.scope_name,
        NOT: { scope_id: scopeId },
      },
    });
    if (conflict)
      throw new BadRequestException(
        'A sibling scope with this name already exists',
      );

    const updated = await this.prisma.org_scope.update({
      where: { scope_id: scopeId },
      data: { scope_name: dto.scope_name },
    });

    return updated;
  }

  // ─── Delete scope node ───────────────────────────────────────────────────────
  async deleteScope(orgid: string, callerUid: string, scopeId: number) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerOrganizerScopes =
      await this.orgService.getCallerOrganizerScopes(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(
      callerOrganizerScopes,
    );

    if (!visibleIds.includes(scopeId)) {
      throw new ForbiddenException(
        'Cannot delete a scope outside your subtree',
      );
    }

    const node = await this.prisma.org_scope.findUnique({
      where: { scope_id: scopeId },
    });
    if (!node) throw new NotFoundException('Scope node not found');
    if (node.parent_scope_id === null) {
      throw new BadRequestException('Cannot delete the ROOT scope');
    }

    // Application-level event guard (not covered by the DB delete trigger)
    const eventsInScope = await this.prisma.events.count({
      where: { orgid, scope_id: scopeId, is_deleted: false },
    });
    if (eventsInScope > 0) {
      throw new BadRequestException(
        `Cannot delete: ${eventsInScope} event(s) exist in this scope.`,
      );
    }

    // DB trigger will raise if node has child scopes or assigned members
    try {
      await this.prisma.org_scope.delete({ where: { scope_id: scopeId } });
    } catch (e: any) {
      const originalMessage = e?.cause?.originalMessage ?? e?.message;
      if (originalMessage) throw new BadRequestException(originalMessage);
      throw e;
    }
    return { message: `Scope node ${scopeId} deleted` };
  }
}

// ─── Tree builder ─────────────────────────────────────────────────────────────
// Builds a forest from flatNodes, using rootIds as the set of entry-point roots.
function buildForest(
  nodes: {
    scope_id: number;
    scope_name: string;
    parent_scope_id: number | null;
  }[],
  rootIds: number[],
): ScopeNode[] {
  const rootSet = new Set(rootIds);
  const map = new Map<number, ScopeNode>();

  for (const n of nodes) {
    map.set(n.scope_id, { ...n, children: [] });
  }

  const roots: ScopeNode[] = [];

  for (const node of map.values()) {
    // Treat as root if it is one of the caller's organizer scopes,
    // has no parent, or its parent is outside the visible slice.
    if (
      rootSet.has(node.scope_id) ||
      node.parent_scope_id === null ||
      !map.has(node.parent_scope_id)
    ) {
      roots.push(node);
    } else {
      const parent = map.get(node.parent_scope_id)!;
      parent.children.push(node);
    }
  }

  return roots;
}
