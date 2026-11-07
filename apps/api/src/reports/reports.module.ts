import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DashboardService } from './dashboard.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Role-aware dashboard tasks and scoped reports (spec §4.14 — P5c). */
@Module({
  imports: [EventsModule],
  controllers: [ReportsController],
  providers: [ReportsService, DashboardService],
})
export class ReportsModule {}
