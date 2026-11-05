import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SequenceService } from './sequence.service';
import { AccessService } from './access.service';
import { FieldCryptoService } from './field-crypto.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [AuditService, SequenceService, AccessService, FieldCryptoService, SettingsService],
  exports: [AuditService, SequenceService, AccessService, FieldCryptoService, SettingsService],
})
export class CommonModule {}
