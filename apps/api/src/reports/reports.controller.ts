import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { DashboardService } from './dashboard.service';
import { EventReportQueryDto, ReportFilterDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly dashboard: DashboardService,
  ) {}

  @ApiOperation({ summary: 'งานที่รอผู้ใช้ดำเนินการ (ตามสิทธิ์และขอบเขต)' })
  @Get('dashboard/tasks')
  tasks(@CurrentUser() u: AuthUser) {
    return this.dashboard.tasks(u);
  }

  @RequirePermissions('report:view')
  @ApiOperation({ summary: 'ตัวชี้วัดรวม แนวโน้มรายเดือน และสัดส่วนตามหน่วยงาน/หมวดหมู่/ประเภทผู้เข้าร่วม' })
  @Get('reports/overview')
  overview(@Query() q: ReportFilterDto, @CurrentUser() u: AuthUser) {
    return this.reports.overview(u, q);
  }

  @RequirePermissions('report:view')
  @Get('reports/events')
  events(@Query() q: EventReportQueryDto, @CurrentUser() u: AuthUser) {
    return this.reports.events(u, q);
  }

  @RequirePermissions('report:export')
  @Get('reports/events/export')
  export(@Query() q: EventReportQueryDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.reports.export(u, q, m);
  }

  @RequirePermissions('report:view', 'payment:view')
  @Get('reports/finance')
  finance(@Query() q: ReportFilterDto, @CurrentUser() u: AuthUser) {
    return this.reports.finance(u, q);
  }

  @RequirePermissions('report:view')
  @Get('reports/participants')
  participants(@Query() q: ReportFilterDto, @CurrentUser() u: AuthUser) {
    return this.reports.participants(u, q);
  }
}
