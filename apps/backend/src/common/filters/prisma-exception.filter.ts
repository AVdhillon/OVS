// src/common/filters/prisma-exception.filter.ts

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  // Turns a P2002 `meta.target` into something safe to show a user. The raw
  // target is a list of DB column names (e.g. "pid, identity_type,
  // identity_id") that means nothing to a user and leaks schema details, so
  // only columns with a user-meaningful name are mentioned; anything else
  // (internal/composite keys) gets a generic message. Services that know the
  // real cause should catch P2002 themselves and throw a specific
  // ConflictException — this is only the safety net.
  private describeUniqueViolation(target: unknown): string {
    const friendly: Record<string, string> = {
      email: 'email address',
      mobile: 'mobile number',
      org_email: 'organization email',
      org_name: 'organization name',
    };
    const cols = Array.isArray(target)
      ? (target as string[])
      : typeof target === 'string'
        ? [target]
        : [];
    const labels = cols
      .map((c) => friendly[c])
      .filter((l): l is string => Boolean(l));
    return labels.length > 0
      ? `A record with this ${labels.join(' / ')} already exists`
      : 'This record already exists';
  }

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientUnknownRequestError
      | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        // Unique constraint violation
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          message = this.describeUniqueViolation(exception.meta?.target);
          break;
        }
        // Record not found (findUniqueOrThrow / updateOrThrow)
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        // Foreign key constraint failed
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Referenced record does not exist';
          break;
        // Required field missing
        case 'P2011':
          status = HttpStatus.BAD_REQUEST;
          message = 'Required field missing';
          break;
        // A database constraint failed (e.g. a CHECK constraint such as
        // org_members.mobile's 10-digit format) — surface as a clean 400
        // instead of a raw 500, as a safety net for any app/DB validation
        // mismatch we haven't caught at the application layer.
        case 'P2004':
          status = HttpStatus.BAD_REQUEST;
          message = 'Value violates a database constraint';
          break;
        default:
          this.logger.error(
            `Unhandled Prisma error ${exception.code}: ${exception.message}`,
          );
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data sent to database';
    }

    // Postgres-level RAISE EXCEPTION from triggers comes through as
    // PrismaClientUnknownRequestError with the message in exception.message
    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      // Extract the user-facing message from Postgres trigger exceptions.
      // Format: "... ERROR: <our message>\nDETAIL: ..."
      const match = exception.message.match(/ERROR:\s*(.+?)(?:\n|$)/);
      if (match) {
        status = HttpStatus.BAD_REQUEST;
        message = match[1].trim();
      } else {
        this.logger.error(`Unknown Prisma error: ${exception.message}`);
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
