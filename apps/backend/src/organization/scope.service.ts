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

    // Default parent = caller's own scope node
    const parentId = dto.parent_scope_id ?? callerScope;

    if (!visibleIds.includes(parentId)) {
      throw new ForbiddenException('Cannot create scope outside your subtree');
    }

    // Ensure name is unique within same parent
    const conflict = await this.prisma.org_scope.findFirst({
      where: { orgid, parent_scope_id: parentId, scope_name: dto.scope_name },
    });
    if (conflict) throw new BadRequestException('A scope with this name already exists at that level');

    const created = await this.prisma.org_scope.create({
      data: { orgid, scope_name: dto.scope_name, parent_scope_id: parentId },
    });

    return created;
  }

  // ─── Rename / reattach scope node ───────────────────────────────────────────
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

    // Prevent moving to outside of caller's tree
    if (dto.parent_scope_id !== undefined && dto.parent_scope_id !== null) {
      if (!visibleIds.includes(dto.parent_scope_id)) {
        throw new ForbiddenException('Cannot reattach scope to a node outside your subtree');
      }
    }

    // Prevent moving ROOT
    const node = await this.prisma.org_scope.findUnique({ where: { scope_id: scopeId } });
    if (!node) throw new NotFoundException('Scope node not found');
    if (node.parent_scope_id === null) {
      throw new BadRequestException('Cannot move or rename the ROOT scope');
    }

    // DB trigger will detect cycle — just pass through
    const updated = await this.prisma.org_scope.update({
      where: { scope_id: scopeId },
      data: {
        ...(dto.scope_name !== undefined && { scope_name: dto.scope_name }),
        ...(dto.parent_scope_id !== undefined && { parent_scope_id: dto.parent_scope_id }),
      },
    });

    return updated;
  }

  // ─── Delete scope node ───────────────────────────────────────────────────────
  async deleteScope(orgid: string, callerUid: string, scopeId: number) {
    await this.orgService.assertOrganizerAccess(orgid, callerUid);

    const callerScope = await this.orgService.getCallerScope(orgid, callerUid);
    const visibleIds = await this.orgService.getDescendantScopeIds(callerScope);

    if (!visibleIds.includes(scopeId)) {
      throw new ForbiddenException('Cannot delete a scope outside your subtree');
    }

    const node = await this.prisma.org_scope.findUnique({ where: { scope_id: scopeId } });
    if (!node) throw new NotFoundException('Scope node not found');
    if (node.parent_scope_id === null) {
      throw new BadRequestException('Cannot delete the ROOT scope');
    }

    // Check if any members or events are assigned to this scope or descendants
    const descendants = await this.orgService.getDescendantScopeIds(scopeId);

    const membersInScope = await this.prisma.member_roles.count({
      where: { orgid, scope_id: { in: descendants } },
    });
    if (membersInScope > 0) {
      throw new BadRequestException(
        `Cannot delete: ${membersInScope} member(s) are assigned to this scope or its children. Reassign them first.`,
      );
    }

    const eventsInScope = await this.prisma.events.count({
      where: { orgid, scope_id: { in: descendants }, is_deleted: false },
    });
    if (eventsInScope > 0) {
      throw new BadRequestException(
        `Cannot delete: ${eventsInScope} event(s) exist in this scope or its children.`,
      );
    }

    await this.prisma.org_scope.delete({ where: { scope_id: scopeId } });

    return { message: `Scope node ${scopeId} deleted` };
  }
}

// ─── Tree builder ─────────────────────────────────────────────────────────────
function buildTree(
  nodes: { scope_id: number; scope_name: string; parent_scope_id: number | null }[],
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
      const parent = map.get(node.parent_scope_id!);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent is outside caller's visible tree — treat as root of visible subtree
        roots.push(node);
      }
    }
  }

  return roots;
}
