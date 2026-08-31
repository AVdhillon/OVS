import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
    // Global request-rate limiting (fraud-heuristic-implementation-plan.md,
    // Module A). Applies a moderate app-wide default; the login/OTP
    // endpoints in auth.controller.ts override this with tighter
    // route-specific limits via @Throttle(), since those are the
    // brute-force/credential-stuffing surface this module targets.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute
        limit: 60, // 60 requests/min/IP across the app by default
      },
    ]),
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
    // Global rate-limit guard (fraud-heuristic-implementation-plan.md,
    // Module A). Registered app-wide so every route is throttled by
    // default; auth.controller.ts narrows the limit further on the
    // login/OTP endpoints specifically.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
