import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { ScopeService } from './scope.service';
import { OrgController } from './org.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OrgService, ScopeService],
  controllers: [OrgController],
  exports: [OrgService, ScopeService],
})
export class OrgModule {}
