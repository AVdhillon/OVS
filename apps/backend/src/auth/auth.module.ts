import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpModule } from '../otp/otp.module'; // ← import OtpModule
import { getJwtSecret } from '../common/utils/jwt-secret.util';

@Module({
  imports: [
    PrismaModule,
    OtpModule, // ← provides OtpService
    JwtModule.registerAsync({
      // SECURITY: no hardcoded fallback secret — see jwt-secret.util.ts.
      // Throws at module-init time in production if JWT_SECRET is unset.
      // useFactory is resolved lazily at DI-instantiation time (same timing
      // as JwtStrategy's constructor), not at file-require time — this
      // keeps signing and verification reading the same secret even if
      // module import order ever changes.
      useFactory: () => ({
        secret: getJwtSecret(),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
