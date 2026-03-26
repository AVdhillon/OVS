import { Module } from '@nestjs/common';
import { VotingService } from './voting.service';
import { VotingController } from './voting.controller';

@Module({
  providers: [VotingService],
  controllers: [VotingController]
})
export class VotingModule {}
