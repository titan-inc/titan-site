import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { lootHistoryQuerySchema, type LootHistoryPage, type LootHistoryQuery } from '@titan/shared';
import { MemberGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LootHistoryService } from './loot-history.service';

/**
 * Consulta do histórico de loot.
 *
 * `MemberGuard`, e não `OfficerGuard`: o histórico de loot é visível a todos que
 * entram na área interna. A régua da Regra 7 — "isto vira comparação entre
 * membros?" — responde diferente aqui e em presença, e o motivo está escrito
 * lá: presença é comportamento de uma pessoa, loot é decisão que o conselho
 * tomou na frente da raid inteira. Quem estava lá viu a peça ser distribuída.
 *
 * O guard existe mesmo assim, pela Regra 5: o teste não é "a UI esconde?", é
 * "chamado sem cookie devolve 401?".
 */
@Controller('internal/loot-history')
@UseGuards(MemberGuard)
export class LootHistoryController {
  constructor(private readonly history: LootHistoryService) {}

  /**
   * Uma página do histórico, com filtros combináveis.
   *
   * A validação é o schema do shared, e não parse manual: são sete parâmetros, e
   * `?difficulty=mitico` tem que virar 400 dizendo qual campo recusou — solto no
   * `where` do Prisma viraria 500 sem explicar nada.
   */
  @Get()
  consultar(
    @Query(new ZodValidationPipe(lootHistoryQuerySchema, 'Filtro'))
    filtros: LootHistoryQuery,
  ): Promise<LootHistoryPage> {
    return this.history.consultar(filtros);
  }
}
