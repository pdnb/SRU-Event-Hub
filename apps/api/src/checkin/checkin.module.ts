import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController, CheckinController, PersonnelController } from './checkin.controller';
import { CheckinGateway } from './checkin.gateway';
import { CheckinService } from './checkin.service';
import { EventAccessService } from './event-access.service';
import { PersonnelService } from './personnel.service';

/** QR check-in, attendance, event personnel and the real-time gateway (spec §4.8, §4.9 — P4). */
@Module({
  imports: [AuthModule],
  controllers: [CheckinController, AttendanceController, PersonnelController],
  providers: [CheckinService, AttendanceService, PersonnelService, EventAccessService, CheckinGateway],
  exports: [CheckinService, EventAccessService],
})
export class CheckinModule {}
