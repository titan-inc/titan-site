import { Module } from '@nestjs/common';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { CharactersModule } from '../characters/characters.module';
import { WowAuditModule } from '../wowaudit/wowaudit.module';
import { ElegibilidadeService } from './elegibilidade.service';
import { ReadyService } from './ready.service';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * Titan Bet — ver docs/specs/titan-bet.md.
 *
 * Ainda sem controller: as rotas (superfície do membro e Officer Panel) entram
 * no milestone de autorização, com os testes de 401/403 antes.
 */
@Module({
  imports: [BlizzardModule, CharactersModule, WowAuditModule],
  providers: [TitanBetRepository, ReadyService, ElegibilidadeService],
  exports: [ReadyService, ElegibilidadeService],
})
export class TitanBetModule {}
