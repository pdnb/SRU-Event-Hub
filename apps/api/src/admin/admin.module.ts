import { Module } from '@nestjs/common';
import { AuditLogsController, SettingsController } from './admin.controllers';

@Module({ controllers: [AuditLogsController, SettingsController] })
export class AdminModule {}
