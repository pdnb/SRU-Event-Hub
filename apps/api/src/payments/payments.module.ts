import { Module } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { CashierService } from './cashier.service';
import { FinanceBatchesController } from './finance-batches.controller';
import { CashierController, RefundsController } from './finance-ops.controller';
import { RefundsService } from './refunds.service';
import { FinanceBatchesService } from './finance-batches.service';
import { FinanceSettingsController } from './finance-settings.controller';
import { PaymentQueue } from './payment-queue';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';

/** Payment & finance (spec §4.7). Registration depends on this module, never the reverse. */
@Module({
  controllers: [PaymentsController, FinanceBatchesController, FinanceSettingsController, CashierController, RefundsController, ReconciliationController],
  providers: [PaymentsService, PaymentQueue, StorageService, FinanceBatchesService, CashierService, RefundsService, ReconciliationService],
  exports: [PaymentsService, PaymentQueue, StorageService],
})
export class PaymentsModule {}
