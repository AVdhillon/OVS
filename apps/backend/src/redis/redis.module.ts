import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global() // makes it available everywhere, same as PrismaModule
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
