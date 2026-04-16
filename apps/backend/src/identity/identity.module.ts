import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OtpModule } from '../otp/otp.module';

@Module({
  imports: [PrismaModule, OtpModule],
  providers: [IdentityService],
  controllers: [IdentityController],
  exports: [IdentityService],
})
export class IdentityModule {}
