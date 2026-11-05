import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PaymentExpiryWorker } from '../payments/payment-expiry.worker';
import { PaymentsModule } from '../payments/payments.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [EventsModule, PaymentsModule],
  controllers: [RegistrationsController],
  // The expiry worker lives here because it drives RegistrationsService (seat release + waitlist).
  providers: [RegistrationsService, PaymentExpiryWorker],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
