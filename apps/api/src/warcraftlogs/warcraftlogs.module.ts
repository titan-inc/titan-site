import { Module } from '@nestjs/common';
import { WarcraftLogsService } from './warcraftlogs.service';

@Module({
  providers: [WarcraftLogsService],
  exports: [WarcraftLogsService],
})
export class WarcraftLogsModule {}
