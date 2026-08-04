import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
// FIX: CandidatesService and CandidatesController existed as files but were never
//      registered in the module — NestJS DI could not resolve them at runtime.
import { CandidatesService } from './candidates.service';
import { CandidatesController } from './candidates.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OrgModule } from '../organization/org.module';

@Module({
  imports: [PrismaModule, OrgModule],
  providers: [EventsService, CandidatesService],
  controllers: [EventsController, CandidatesController],
  exports: [EventsService],
})
export class EventsModule {}
