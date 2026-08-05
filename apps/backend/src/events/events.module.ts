import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
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
