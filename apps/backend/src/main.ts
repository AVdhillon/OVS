import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── 0. Cookies ─────────────────────────────────────────────────────────────
  // Needed before route handling: auth now reads the JWT from an httpOnly
  // cookie (see jwt.strategy.ts) instead of the Authorization header.
  app.use(cookieParser());

  // Swagger config
  if (process.env.NODE_ENV !== 'production') {
    // EDIT (JWT-in-cookie migration): the API no longer accepts a bearer
    // token — auth is via the httpOnly `ovp_token` cookie set on login, so
    // advertising a Bearer "Authorize" button here would be misleading.
    // Swagger has no first-class "httpOnly cookie" scheme to document, and
    // since the cookie can't be set manually from the Swagger UI anyway
    // (the browser only accepts it from a real Set-Cookie response), the
    // most honest option is to drop the auth scheme entirely: exercise
    // /auth/login from the docs UI itself (same-origin, credentials
    // included by the browser) rather than pasting in a token.
    const config = new DocumentBuilder()
      .setTitle('My API')
      .setDescription(
        'API documentation. Authentication is via an httpOnly session ' +
          'cookie set by POST /auth/login — there is no bearer token to ' +
          'paste in here.',
      )
      .setVersion('1.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('api-docs', app, document, {
      swaggerOptions: {
        withCredentials: true, // send the ovp_token/ovp_csrf cookies on "Try it out"
      },
    });
  }
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
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [];

  if (!allowedOrigins.length && process.env.NODE_ENV === 'production') {
    throw new Error('ALLOWED_ORIGINS must be set in production');
  }

  // EDIT (Phase 1 — auth model consolidation, subphase 1.3): the standalone
  // admin app (skeleton lands in subphase 1.10) is served from its own
  // origin — e.g. https://admin.example.com — separate from the regular
  // frontend's origin(s) above. Kept as its own env var rather than just
  // appended into ALLOWED_ORIGINS so the two lists can be configured and
  // audited independently: the admin origin fronts SiteAdminGuard-protected
  // routes (subphase 1.3) and is a materially higher-trust surface than the
  // regular ALLOWED_ORIGINS list, worth being able to reason about on its
  // own rather than buried in a combined comma-separated value.
  const adminAllowedOrigins =
    process.env.ADMIN_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [];

  if (!adminAllowedOrigins.length && process.env.NODE_ENV === 'production') {
    console.warn(
      'ADMIN_ALLOWED_ORIGINS is not set — the admin app origin will be ' +
        'rejected by CORS until this is configured.',
    );
  }

  // Preview-deployment allowance: by default any *.vercel.app origin is
  // trusted, which is broader than intended (any Vercel project/user can
  // stand up a subdomain that ends in vercel.app). If VERCEL_PREVIEW_PREFIX
  // is set (e.g. "ovs-frontend" for previews like
  // ovs-frontend-git-branch-team.vercel.app), only origins starting with
  // that prefix are trusted. Leave unset only if you intentionally want to
  // trust all Vercel preview URLs.
  const vercelPreviewPrefix = process.env.VERCEL_PREVIEW_PREFIX?.trim();
  if (!vercelPreviewPrefix && process.env.NODE_ENV === 'production') {
    console.warn(
      'VERCEL_PREVIEW_PREFIX is not set — CORS will trust ANY *.vercel.app origin. ' +
        'Set VERCEL_PREVIEW_PREFIX to your Vercel project slug to scope this down.',
    );
  }
  const isTrustedVercelPreview = (origin: string): boolean => {
    if (!origin.endsWith('.vercel.app') && origin !== 'https://vercel.app') {
      return false;
    }
    if (!vercelPreviewPrefix) return true; // unscoped fallback (see warning above)
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      return false;
    }
    return host.startsWith(vercelPreviewPrefix);
  };

  app.enableCors({
    origin: (origin, callback) => {
      // allow non-browser requests
      if (!origin) return callback(null, true);

      // exact match — regular frontend
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // exact match — admin app origin
      if (adminAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // allow Vercel previews (VERY useful), optionally scoped to a
      // specific project prefix via VERCEL_PREVIEW_PREFIX
      if (isTrustedVercelPreview(origin)) {
        return callback(null, true);
      }

      console.error('CORS BLOCKED:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  // ── 7. Start ───────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`Application running on: ${await app.getUrl()}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
