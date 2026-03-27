import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── 1. Global Validation Pipe ──────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // strip unknown fields from body
      forbidNonWhitelisted: true, // throw if unknown fields are sent
      transform: true,          // auto-transform @Param / @Query to declared types
      transformOptions: {
        enableImplicitConversion: true, // e.g. '123' → number for @Query params
      },
    }),
  );

  // ── 2. Global Exception Filters ────────────────────────────────────────────
  // Order matters: NestJS applies filters last-to-first.
  // PrismaExceptionFilter must be registered BEFORE HttpExceptionFilter
  // so Prisma errors are caught before the generic HTTP handler runs.
  app.useGlobalFilters(
    new PrismaExceptionFilter(),
    new HttpExceptionFilter(),
  );

  // ── 3. Global Interceptor — BigInt serialization ───────────────────────────
  app.useGlobalInterceptors(new BigIntInterceptor());

  // ── 4. CORS (adjust origins for production) ────────────────────────────────
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();