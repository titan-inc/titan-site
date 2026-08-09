import { Module } from '@nestjs/common';
import { BlizzardModule } from '../blizzard/blizzard.module';
import { WarcraftLogsModule } from '../warcraftlogs/warcraftlogs.module';
import { LootCatalogGeneratorService } from './loot-catalog-generator.service';
import { LootCatalogRepository } from './loot-catalog.repository';
import { LootCatalogService } from './loot-catalog.service';

/**
 * Catálogo de loot: raid → boss → o que solta em cada dificuldade.
 *
 * Sem controller ainda — o endpoint e o guard dele são o TIT-48. Endpoint
 * interno sem guard é o que a Regra 5 proíbe, então ele não nasce solto aqui
 * "só para já existir".
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
  imports: [WarcraftLogsModule, BlizzardModule],
  providers: [LootCatalogService, LootCatalogRepository, LootCatalogGeneratorService],
  exports: [LootCatalogService, LootCatalogRepository, LootCatalogGeneratorService],
})
export class LootCatalogModule {}
