import { Module } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Catálogo de loot: raid → boss → o que solta em cada dificuldade.
 *
 * Sem controller ainda — o endpoint e o guard dele são o TIT-48. Endpoint
 * interno sem guard é o que a Regra 5 proíbe, então ele não nasce solto aqui
 * "só para já existir".
 *
 * O `CatalogRepository` é exportado porque o dicionário de itens é
 * compartilhado: o import do histórico também precisa garantir que um `itemID`
 * existe antes de gravar a linha de loot. Prisma segue confinado a um repository
 * só, que é o que a Regra 3 pede.
 */
@Module({
  providers: [CatalogService, CatalogRepository],
  exports: [CatalogService, CatalogRepository],
})
export class CatalogModule {}
