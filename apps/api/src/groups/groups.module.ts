import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { GroupImportsService } from './group-imports.service';
import { GroupInvitationsService } from './group-invitations.service';
import { GroupsController, ParticipantOrgsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { ParticipantOrgsService } from './participant-orgs.service';

/** Group registration (spec §4.6.1, P3). Builds on registrations (seats, waitlist) and payments. */
@Module({
  imports: [RegistrationsModule, PaymentsModule],
  controllers: [ParticipantOrgsController, GroupsController],
  providers: [GroupsService, GroupInvitationsService, GroupImportsService, ParticipantOrgsService],
})
export class GroupsModule {}
