import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpDeliveryService } from './otp-delivery.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CronModule } from '../cron/cron.module';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * OtpModule
 *
 * Exports OtpService so any other module (auth, identity, users)
 * can inject it instead of duplicating OTP logic.
 *
 * Usage in another module:
 *   imports: [OtpModule]
 *   then inject: constructor(private otp: OtpService) {}
 */
@Module({
  imports: [ScheduleModule.forRoot(),
    CronModule,PrismaModule],
  providers: [OtpService, OtpDeliveryService],
  exports: [OtpService],
})
export class OtpModule {}
