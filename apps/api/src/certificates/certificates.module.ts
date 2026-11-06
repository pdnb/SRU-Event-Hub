import { Module } from '@nestjs/common';
import { CheckinModule } from '../checkin/checkin.module';
import { EvaluationsModule } from '../evaluations/evaluations.module';
import { StorageService } from '../storage/storage.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/** Certificate templates, issue / self-claim / revoke and public verification (spec §4.10 — P5a). */
@Module({
  imports: [CheckinModule, EvaluationsModule],
  controllers: [CertificatesController],
  providers: [CertificatesService, StorageService],
})
export class CertificatesModule {}
