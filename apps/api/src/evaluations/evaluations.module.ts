import { Module } from '@nestjs/common';
import { CheckinModule } from '../checkin/checkin.module';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';

/** Evaluation forms, responses and results (spec §4.11 — P5a). */
@Module({
  imports: [CheckinModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
