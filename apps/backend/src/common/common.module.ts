// src/common/common.module.ts

import { Global, Module, forwardRef } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrgModule } from '../organization/org.module';

/**
 * @Global() so RolesGuard can be injected anywhere without re-importing
 * this module.
 *
 * Imports OrgModule (forwardRef, since nothing in OrgModule imports
 * CommonModule today, but forwardRef keeps this safe if that ever changes)
 * so RolesGuard can use OrgService.resolveCallerUid — the same
 * pid-anchored resolver OrgService's own methods use.
 *
 * NOTE: ScopeGuard/@RequireScope() were deliberately removed — they were
 * unused dead code that resolved orgid/uid straight from req.params/
 * req.body without verifying the caller actually owned that uid (the same
 * class of IDOR bug fixed elsewhere for events). If scope-based route
 * guarding is needed again, rebuild it on top of
 * OrgService.resolveCallerUid() the way RolesGuard is, not by trusting
 * client-supplied uid directly.
 */
@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => OrgModule)],
  providers: [RolesGuard],
  exports: [RolesGuard],
})
export class CommonModule {}