import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── 1. Global prefix ───────────────────────────────────────────────────────
  //app.setGlobalPrefix('api/v1');

  // ── 2. Graceful shutdown ───────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── 3. Validation Pipe ─────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── 4. Exception Filters (applied first-to-last globally) ──────────────────
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  // ── 5. Interceptors ────────────────────────────────────────────────────────
  app.useGlobalInterceptors(new BigIntInterceptor());

  // ── 6. CORS ────────────────────────────────────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',');
  if (!allowedOrigins && process.env.NODE_ENV === 'production') {
    throw new Error('ALLOWED_ORIGINS must be set in production');
  }
  app.enableCors({ origin: allowedOrigins ?? '*', credentials: true });

  // ── 7. Start ───────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`Application running on: ${await app.getUrl()}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
