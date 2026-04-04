import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrgModule } from './organization/org.module';
import { EventsModule } from './events/events.module';
import { VotingModule } from './voting/voting.module';
import { OtpModule } from './otp/otp.module';
import { IdentityModule } from './identity/identity.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
@Module({
  imports: [
    CommonModule,
    AuthModule,
    UsersModule,
    IdentityModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrgModule,
    EventsModule,
    VotingModule,
    OtpModule,
    IdentityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
