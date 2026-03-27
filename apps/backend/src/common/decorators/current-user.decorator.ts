// src/common/decorators/current-user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtUser {
  pid?: number;           // present for UNIFIED / ORG logins
  type: 'UNIFIED' | 'ORG' | 'GOV';
  orgid?: string;         // ORG login
  uid?: string;           // ORG login
  epic_id?: string;       // GOV login
  session_id: string;
}

/**
 * @CurrentUser() user: JwtUser
 * Extracts the validated JWT payload attached by JwtStrategy.validate()
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtUser;
  },
);