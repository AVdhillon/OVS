// src/common/common.module.ts

import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { ScopeGuard } from './guards/scope.guard';
import { PrismaModule } from 'src/prisma/prisma.module';

/**
 * @Global() so RolesGuard and ScopeGuard can be injected
 * anywhere without re-importing this module.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RolesGuard, ScopeGuard],
  exports: [RolesGuard, ScopeGuard],
})
export class CommonModule {}