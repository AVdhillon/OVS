import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OtpModule } from '../otp/otp.module'; // FIX: added — needed to inject OtpService

@Module({
  imports: [PrismaModule, OtpModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
