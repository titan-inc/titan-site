import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { WarcraftLogsModule } from '../warcraftlogs/warcraftlogs.module';
import { LootCatalogController } from './loot-catalog.controller';
import { LootCatalogGeneratorService } from './loot-catalog-generator.service';
import { LootCatalogRepository } from './loot-catalog.repository';
import { LootCatalogService } from './loot-catalog.service';

/**
 * Catálogo de loot: raid → boss → o que solta em cada dificuldade.
 *
 * A leitura tem controller com `MemberGuard`; a escrita não tem, e é de
 * propósito. Cadastrar catálogo é operação de bastidor, e vive em
 * `/internal/ops/catalog-*` sob `OpsTokenGuard` — ator diferente, pela Regra 8.
 * Não existe rota de escrita por sessão de Battle.net.
 *
 * O `LootCatalogRepository` é exportado porque o dicionário de itens é
 * compartilhado: o import do histórico também precisa garantir que um `itemID`
 * existe antes de gravar a linha de loot. Prisma segue confinado a um repository
 * só, que é o que a Regra 3 pede.
 */
@Module({
  // O WarcraftLogs entra pela conferência de `dungeonEncounterId` na carga: o
  // WCL responde o nome do boss a partir do mesmo id que o jogo usa, e é isso
  // que transforma id errado em erro detectável. O gerador usa o mesmo catálogo
  // do WCL pelo outro lado — para descobrir o id em vez de conferi-lo — e a
  // Blizzard para a raid, os bosses e os itens.
  // `AuthModule` entra pelo `MemberGuard` do controller de leitura.
  imports: [WarcraftLogsModule, BlizzardModule, AuthModule],
  controllers: [LootCatalogController],
  providers: [LootCatalogService, LootCatalogRepository, LootCatalogGeneratorService],
  exports: [LootCatalogService, LootCatalogRepository, LootCatalogGeneratorService],
})
export class LootCatalogModule {}
