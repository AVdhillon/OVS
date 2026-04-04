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

    const callerScope = await this.orgService.getCallerScope(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(callerScope);

    const allScopes = await this.prisma.org_scope.findMany({
      where: { orgid, scope_id: { in: visibleIds } },
      select: { scope_id: true, scope_name: true, parent_scope_id: true },
      orderBy: { scope_id: 'asc' },
    });

    return buildTree(allScopes, callerScope);
  }

  // ─── Add scope node ──────────────────────────────────────────────────────────
  async createScope(orgid: string, callerUid: string, dto: CreateScopeDto) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.orgService.getCallerScope(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(callerScope);

    const parentId = dto.parent_scope_id ?? callerScope;

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
  // FIX: renamed from "updateScope (rename / reattach)" to rename-only.
  // Project design: "Scope is a fixed tree — nodes are not moved."
  // Removed: parent_scope_id acceptance, reattachment cycle check, and the
  //          closure-table rebuild that would have been required for reattachment.
  async updateScope(
    orgid: string,
    callerUid: string,
    scopeId: number,
    dto: UpdateScopeDto,
  ) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.orgService.getCallerScope(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(callerScope);

    if (!visibleIds.includes(scopeId)) {
      throw new ForbiddenException('Cannot edit a scope outside your subtree');
    }

    const node = await this.prisma.org_scope.findUnique({
      where: { scope_id: scopeId },
    });
    if (!node) throw new NotFoundException('Scope node not found');

    // ROOT node has no parent — prevent renaming it to avoid confusion
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
  // The DB trigger (trg_prevent_nonempty_scope_delete) enforces that the node
  // has no direct children and no members assigned. The application-level
  // events check here is an additional safety layer not covered by the trigger.
  async deleteScope(orgid: string, callerUid: string, scopeId: number) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.orgService.getCallerScope(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(callerScope);

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
      // Postgres raised exception (P0001) — extract the human message
      const originalMessage = e?.cause?.originalMessage ?? e?.message;
      if (originalMessage) throw new BadRequestException(originalMessage);
      throw e;
    }
    return { message: `Scope node ${scopeId} deleted` };
  }
}

// ─── Tree builder ─────────────────────────────────────────────────────────────
function buildTree(
  nodes: {
    scope_id: number;
    scope_name: string;
    parent_scope_id: number | null;
  }[],
  rootId: number,
): ScopeNode[] {
  const map = new Map<number, ScopeNode>();

  for (const n of nodes) {
    map.set(n.scope_id, { ...n, children: [] });
  }

  const roots: ScopeNode[] = [];

  for (const node of map.values()) {
    if (node.scope_id === rootId || node.parent_scope_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parent_scope_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent is outside caller's visible subtree — treat as root of visible slice
        roots.push(node);
      }
    }
  }

  return roots;
}
