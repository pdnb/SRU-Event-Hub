import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApprovalsService } from './approvals.service';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** "รายการรออนุมัติ" — requests whose current step the user may decide. */
  @RequirePermissions('approval:approve')
  @Get('pending')
  pending(@CurrentUser() u: AuthUser) {
    return this.approvals.pendingForUser(u);
  }
}
