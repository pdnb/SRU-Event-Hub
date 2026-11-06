import { Global, Module } from '@nestjs/common';
import { LineService } from './line.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { NotificationWorker } from './notification-worker';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** In-app inbox, e-mail + LINE outbox, audit-driven dispatch and reminders (spec §4.12 — P5b). */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDispatcher, NotificationWorker, LineService],
  exports: [NotificationsService, NotificationDispatcher],
})
export class NotificationsModule {}
