// src/common/utils/jwt-secret.util.ts
//
// Single source of truth for resolving the JWT signing secret.
//
// SECURITY: there must be NO hardcoded fallback secret. A hardcoded fallback
// (e.g. `process.env.JWT_SECRET || 'SECRET_KEY'`) means that if the env var
// is ever missing in a deployment, every JWT in the system becomes forgeable
// with a publicly-known string. Fail fast instead.
//
// In non-production environments we allow a clearly-labelled insecure
// dev default so local setup doesn't require a .env file, but we log a loud
// warning so it's never mistaken for a safe configuration.

const INSECURE_DEV_ONLY_SECRET = 'dev-only-insecure-secret-do-not-use-in-prod';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.trim().length > 0) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable must be set in production. ' +
        'Refusing to start with an insecure default.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  JWT_SECRET is not set. Using an insecure development-only default. ' +
      'This must never happen outside local development.',
  );
  return INSECURE_DEV_ONLY_SECRET;
}
