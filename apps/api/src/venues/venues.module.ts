import { Module } from '@nestjs/common';
import { CheckinModule } from '../checkin/checkin.module';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

/** Buildings, venues, equipment and their bookings (spec §4.13 — P5b). */
@Module({
  imports: [CheckinModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
