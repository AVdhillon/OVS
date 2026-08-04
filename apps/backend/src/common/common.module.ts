// src/common/common.module.ts

import { Global, Module, forwardRef } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { ScopeGuard } from './guards/scope.guard';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrgModule } from '../organization/org.module';

/**
 * @Global() so RolesGuard and ScopeGuard can be injected
 * anywhere without re-importing this module.
 *
 * Imports OrgModule (forwardRef, since nothing in OrgModule imports
 * CommonModule today, but forwardRef keeps this safe if that ever changes)
 * so RolesGuard can use OrgService.resolveCallerUid — the same
 * pid-anchored resolver OrgService's own methods use.
 */
@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => OrgModule)],
  providers: [RolesGuard, ScopeGuard],
  exports: [RolesGuard, ScopeGuard],
})
export class CommonModule {}