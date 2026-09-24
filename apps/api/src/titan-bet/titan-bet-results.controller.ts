import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import type { ClosingPublicado } from '@titan/shared';
import { ApostadorDaRodadaGuard } from './apostador-da-rodada.guard';
import { ClosingService } from './closing.service';

/**
 * O que o Titan Bet publica para a guilda (D-21; spec §9): o Round Closing
 * Report. De qualquer membro, apostou ou não — e de quem saiu da guilda com
 * slip nesta rodada (D-53a, `ApostadorDaRodadaGuard`).
 *
 * Só o documento publicado, nunca uma consulta montada na hora sobre apostas
 * (§9.1): o conteúdo foi validado pelo schema publicado ao gravar.
 */
@Controller('internal/titan-bet/rodadas/:roundId')
@UseGuards(ApostadorDaRodadaGuard)
export class TitanBetResultsController {
  constructor(private readonly closing: ClosingService) {}

  @Get('closing')
  async closingReport(@Param('roundId') roundId: string): Promise<ClosingPublicado> {
    const doc = await this.closing.ultimo(roundId);
    if (!doc) throw new NotFoundException('A rodada ainda não tem Closing Report publicado');
    return doc;
  }
}
