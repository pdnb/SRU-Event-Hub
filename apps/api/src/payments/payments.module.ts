import { Module } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { FinanceBatchesController } from './finance-batches.controller';
import { FinanceBatchesService } from './finance-batches.service';
import { FinanceSettingsController } from './finance-settings.controller';
import { PaymentQueue } from './payment-queue';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Payment & finance (spec §4.7). Registration depends on this module, never the reverse. */
@Module({
  controllers: [PaymentsController, FinanceBatchesController, FinanceSettingsController],
  providers: [PaymentsService, PaymentQueue, StorageService, FinanceBatchesService],
  exports: [PaymentsService, PaymentQueue, StorageService],
})
export class PaymentsModule {}
