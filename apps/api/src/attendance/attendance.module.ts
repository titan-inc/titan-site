import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { WarcraftLogsModule } from '../warcraftlogs/warcraftlogs.module';
import { WowAuditModule } from '../wowaudit/wowaudit.module';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';

/**
 * Presença de raid: ingestão (job) e leitura (tela) do mesmo domínio.
 *
 * Dois services de propósito — o de ingestão fala com as APIs externas, o de
 * leitura só toca o banco. Assim a tela não cai quando o WoWAudit cai.
 */
@Module({
  imports: [AuthModule, CharactersModule, WowAuditModule, WarcraftLogsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceReportService, AttendanceRepository],
  exports: [AttendanceService],
})
export class AttendanceModule {}
