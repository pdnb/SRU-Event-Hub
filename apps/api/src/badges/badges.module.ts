import { Module } from '@nestjs/common';
import { CheckinModule } from '../checkin/checkin.module';
import { StorageService } from '../storage/storage.service';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';

/** Badge templates, the PDF engine and print jobs (spec §4.8.1 — P4). */
@Module({
  imports: [CheckinModule],
  controllers: [BadgesController],
  providers: [BadgesService, StorageService],
})
export class BadgesModule {}
