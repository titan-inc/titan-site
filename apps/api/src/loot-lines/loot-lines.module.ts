import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { LootHistoryController } from './loot-history.controller';
import { LootHistoryService } from './loot-history.service';
import { LootLinesRepository } from './loot-lines.repository';
import { RcImportService } from './rc-import.service';

/**
 * O histórico de loot: uma linha por peça entregue por decisão do conselho.
 *
 * **Leitura e escrita entram por portas diferentes**, e é de propósito.
 *
 * A escrita de hoje é importar um arquivo: operação de bastidor, que vive em
 * `/internal/ops/loot-import-rc` sob `OpsTokenGuard` — automação/CLI, ator
 * diferente do modelo de permissão da Regra 4, pela Regra 8.
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
  providers: [RcImportService, LootHistoryService, LootLinesRepository],
  exports: [RcImportService],
})
export class LootLinesModule {}
