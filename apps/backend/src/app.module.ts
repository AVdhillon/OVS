import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrgModule } from './organization/org.module';
import { EventsModule } from './events/events.module';
import { VotingModule } from './voting/voting.module';
import { OtpModule } from './otp/otp.module';
import { IdentityModule } from './identity/identity.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { CsrfGuard } from './common/guards/csrf.guard';
@Module({
  imports: [
    CommonModule,
    AuthModule,
    UsersModule,
    IdentityModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    OrgModule,
    EventsModule,
    VotingModule,
    OtpModule,
    IdentityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global double-submit CSRF check (plan-httponly-cookie-jwt.md, Finding
    // #2, step 6) — see CsrfGuard for why this is registered app-wide
    // rather than per-controller.
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
