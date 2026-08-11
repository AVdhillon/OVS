import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService
  extends Redis
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      throw new Error(
        'REDIS_URL is missing or empty. Set it in .env or the environment.',
      );
    }
    // maxRetriesPerRequest: null is required for BullMQ workers later on,
    // and is harmless if you're only using this as a plain cache client for now.
    super(redisUrl, { maxRetriesPerRequest: null });
  }

  async onModuleInit() {
    // ioredis connects lazily on first command by default, so we ping here
    // to fail fast (and log clearly) if the connection string is wrong.
    try {
      await this.ping();
      this.logger.log('Connected to Redis');
    } catch (err) {
      this.logger.error('Failed to connect to Redis', err as Error);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
