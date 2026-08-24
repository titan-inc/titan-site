import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { LootHistoryController } from './loot-history.controller';
import { LootHistoryService } from './loot-history.service';
import { LootLinesRepository } from './loot-lines.repository';
import { LootLinesService } from './loot-lines.service';
import { RcImportService } from './rc-import.service';

/**
 * O histórico de loot: uma linha por peça entregue por decisão do conselho.
 *
 * **Leitura e escrita entram por portas diferentes**, e é de propósito.
 *
 * A escrita de hoje tem duas fontes: importar um arquivo (operação de
 * bastidor, `/internal/ops/loot-import-rc` sob `OpsTokenGuard`, pela Regra 8)
 * e o encerramento de uma sessão ao vivo (TIT-69) — `LootLinesService`, que
 * `loot-sessions` chama exportado daqui, passando o client da própria
 * transação para as duas escritas commitarem juntas.
 *
 * A leitura é o explorador, com `MemberGuard`: sessão de Battle.net, qualquer
 * pessoa da área interna. Mesmo arranjo do `LootCatalogModule`.
 *
 * `AuthModule` entra pelo `MemberGuard` do controller de leitura.
 * `CharactersModule` entra pelo `RcImportService`, que resolve identidade de
 * quem venceu e de quem lootou antes de gravar.
 */
@Module({
  imports: [AuthModule, CharactersModule],
  controllers: [LootHistoryController],
  providers: [RcImportService, LootHistoryService, LootLinesService, LootLinesRepository],
  exports: [RcImportService, LootLinesService],
})
export class LootLinesModule {}
