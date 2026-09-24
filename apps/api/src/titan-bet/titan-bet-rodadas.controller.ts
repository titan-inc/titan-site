import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { RodadasDoMembro, SessionUser } from '@titan/shared';
import type { Request } from 'express';
import { ApostadorDaRodadaGuard } from './apostador-da-rodada.guard';
import { contaDe } from './http';
import { RodadasService } from './rodadas.service';

/**
 * A lista de rodadas da superfície do membro (T-C01): por onde o front acha a
 * rodada para abrir. Fica fora do controller da rodada porque não tem
 * `:roundId` — o guard, sem rodada na rota, aceita quem tem slip em alguma
 * (D-53a), e o service devolve só as dele.
 */
@Controller('internal/titan-bet')
@UseGuards(ApostadorDaRodadaGuard)
export class TitanBetRodadasController {
  constructor(private readonly rodadas: RodadasService) {}

  @Get('rodadas')
  visiveis(@Req() req: Request): Promise<RodadasDoMembro> {
    const membro = (req as Request & { user: SessionUser }).user.membership === 'member';
    return this.rodadas.visiveis(contaDe(req).userId, membro);
  }
}
