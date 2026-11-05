import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SequenceService } from './sequence.service';
import { AccessService } from './access.service';

@Global()
@Module({
  providers: [AuditService, SequenceService, AccessService],
  exports: [AuditService, SequenceService, AccessService],
})
export class CommonModule {}
