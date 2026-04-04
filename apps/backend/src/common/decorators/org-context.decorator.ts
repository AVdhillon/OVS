// src/common/decorators/org-context.decorator.ts

import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export interface OrgContext {
  orgid: string;
  uid: string;
}

/**
 * @OrgCtx() ctx: OrgContext
 *
 * Resolves orgid + uid from (in priority order):
 *   1. req.user  (when user is logged in via ORG identity)
 *   2. route params  (/orgs/:orgid/members/:uid)
 *   3. request body  ({ orgid, uid })
 *
 * Throws BadRequestException if neither can be resolved.
 */

export function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (!value) return true; // handled by @IsOptional

          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

          // simple international phone (digits, +, 10–15 length)
          const phoneRegex = /^\+?[1-9]\d{9,14}$/;

          return emailRegex.test(value) || phoneRegex.test(value);
        },
        defaultMessage() {
          return 'caller_identifier must be a valid email or phone number';
        },
      },
    });
  };
}
export const OrgCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    // 1. Prefer JWT payload (most trusted)
    if (user?.type === 'ORG' && user.orgid && user.uid) {
      return { orgid: user.orgid, uid: user.uid };
    }

    // 2. Route params
    const orgid = req.params?.orgid ?? req.body?.orgid;
    const uid   = req.params?.uid   ?? req.body?.uid;

    if (orgid && uid) {
      return { orgid, uid };
    }

    throw new BadRequestException('Could not resolve org context (orgid/uid missing)');
  },
);