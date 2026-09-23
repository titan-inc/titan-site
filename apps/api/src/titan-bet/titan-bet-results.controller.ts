import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import type { ClosingPublicado } from '@titan/shared';
import { RosterGuard } from '../auth/session.guard';
import { ClosingService } from './closing.service';

/**
 * O que o Titan Bet publica para a guilda (D-21; spec §9): o Round Closing
 * Report. `RosterGuard` — é de qualquer membro, apostou ou não.
 *
 * Só o documento publicado, nunca uma consulta montada na hora sobre apostas
 * (§9.1): o conteúdo foi validado pelo schema publicado ao gravar.
 */
@Controller('internal/titan-bet/rodadas/:roundId')
@UseGuards(RosterGuard)
export class TitanBetResultsController {
  constructor(private readonly closing: ClosingService) {}

  @Get('closing')
  async closingReport(@Param('roundId') roundId: string): Promise<ClosingPublicado> {
    const doc = await this.closing.ultimo(roundId);
    if (!doc) throw new NotFoundException('A rodada ainda não tem Closing Report publicado');
    return doc;
  }
}
