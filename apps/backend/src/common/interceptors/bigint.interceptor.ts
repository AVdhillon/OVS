// src/common/interceptors/bigint.interceptor.ts

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function replaceBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  // A Date has no enumerable own properties, so without this check it
  // fell through to the generic object branch below — Object.entries(date)
  // is always [], so every created_at/updated_at/reviewed_at field in every
  // response was being silently rewritten to {} before serialization. The
  // frontend then does `new Date({})`, which stringifies to "[object
  // Object]" and parses as Invalid Date. Serialize to ISO 8601 explicitly
  // here (rather than relying on JSON.stringify's own Date.toJSON(), which
  // never runs since this interceptor's map() replaces the object first).
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(replaceBigInt);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        replaceBigInt(v),
      ]),
    );
  }
  return value;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(replaceBigInt));
  }
}
