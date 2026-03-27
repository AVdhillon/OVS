

import { JwtUser } from 'src/common/decorators/current-user.decorator';

declare global {
  namespace Express {
    interface Request {
      user?: JwtUser;
      orgContext?: { orgid: string; uid: string };
      scopeContext?: {
        callerScope: number;
        targetScope: number;
        orgid: string;
        uid: string;
      };
    }
  }
}