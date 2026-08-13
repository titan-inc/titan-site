import { Module } from '@nestjs/common';
import { LootLinesRepository } from './loot-lines.repository';
import { RcImportService } from './rc-import.service';

/**
 * O histórico de loot: uma linha por peça entregue por decisão do conselho.
 *
 * **Sem controller.** O único jeito de escrever aqui hoje é importar um arquivo,
 * que é operação de bastidor e vive em `/internal/ops/loot-import-rc` sob
 * `OpsTokenGuard` — ator diferente do modelo de permissão da Regra 4, pela Regra
 * 8. Mesmo arranjo do `LootCatalogModule` na parte de escrita.
 *
 * A leitura por membro (o explorador da Regra 7) é a TIT-58, e ganha controller
 * com guard próprio quando existir. Criar um vazio agora seria completar padrão
 * sem chamador.
 */
@Module({
  providers: [RcImportService, LootLinesRepository],
  exports: [RcImportService],
})
export class LootLinesModule {}
