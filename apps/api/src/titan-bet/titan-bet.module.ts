import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { CharactersModule } from '../characters/characters.module';
import { WarcraftLogsModule } from '../warcraftlogs/warcraftlogs.module';
import { WowAuditModule } from '../wowaudit/wowaudit.module';
import { ApostasService } from './apostas.service';
import { AuditoriaService } from './auditoria.service';
import { CutoffService } from './cutoff.service';
import { DepositoService } from './deposito.service';
import { ElegibilidadeService } from './elegibilidade.service';
import { OddsService } from './odds.service';
import { PreparacaoService } from './preparacao.service';
import { ReadyService } from './ready.service';
import { TitanBetMemberController } from './titan-bet-member.controller';
import { TitanBetOfficerController } from './titan-bet-officer.controller';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * Titan Bet — ver docs/specs/titan-bet.md.
 *
 * Duas superfícies (D-36): a do membro (`RosterGuard`) e o Officer Panel
 * (`OfficerGuard`), em controllers separados.
 */
@Module({
  imports: [AuthModule, BlizzardModule, CharactersModule, WarcraftLogsModule, WowAuditModule],
  controllers: [TitanBetMemberController, TitanBetOfficerController],
  providers: [
    TitanBetRepository,
    ReadyService,
    ElegibilidadeService,
    ApostasService,
    DepositoService,
    CutoffService,
    OddsService,
    AuditoriaService,
    PreparacaoService,
  ],
  exports: [ReadyService, ElegibilidadeService, ApostasService, DepositoService],
})
export class TitanBetModule {}
