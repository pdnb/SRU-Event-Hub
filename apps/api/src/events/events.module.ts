import { Module } from '@nestjs/common';
import { ApprovalsController } from '../approvals/approvals.controller';
import { ApprovalsService } from '../approvals/approvals.service';
import { EventsController, PublicEventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [PublicEventsController, EventsController, ApprovalsController],
  providers: [EventsService, ApprovalsService],
  exports: [EventsService, ApprovalsService],
})
export class EventsModule {}
