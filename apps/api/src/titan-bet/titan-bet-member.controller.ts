import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  salvarSlipSchema,
  submeterSlipSchema,
  type MeuSlip,
  type OddsDaRodada,
  type SalvarSlip,
  type SubmeterSlip,
} from '@titan/shared';
import type { Request } from 'express';
import { RosterGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApostasService } from './apostas.service';
import { comoHttp, contaDe } from './http';
import { OddsService } from './odds.service';

/**
 * A superfície de apostas do membro (D-01, D-36; spec §16.9).
 *
 * `RosterGuard`, e **não** `MemberGuard`: qualquer membro confirmado da guilda
 * aposta, inclusive quem está acima do corte da área interna (D-01). O guard é
 * só a porta; quem decide se a conta aposta **nesta rodada** é o snapshot de
 * bettors do Ready (D-32, D-38), conferido no service e pela FK do slip.
 *
 * Só o próprio slip: nenhuma rota aceita id de slip. O slip é "o da conta da
 * sessão nesta rodada" — não há id de outra pessoa para pedir.
 */
@Controller('internal/titan-bet/rodadas/:roundId')
@UseGuards(RosterGuard)
export class TitanBetMemberController {
  constructor(
    private readonly apostas: ApostasService,
    private readonly odds: OddsService,
  ) {}

  /** Projected payout de todos os mercados publicados — só multiplicadores (§16.10). */
  @Get('odds')
  oddsDaRodada(@Param('roundId') roundId: string, @Req() req: Request): Promise<OddsDaRodada> {
    return comoHttp(() => this.odds.daRodada(roundId, contaDe(req).userId));
  }

  @Get('slip')
  async meuSlip(@Param('roundId') roundId: string, @Req() req: Request): Promise<MeuSlip> {
    const slip = await this.apostas.meuSlip(roundId, contaDe(req).userId);
    if (!slip) throw new NotFoundException('Você não tem slip nesta rodada');
    return slip;
  }

  /** "Salvar" (D-27): o rascunho inteiro, como está agora. */
  @Put('slip')
  salvar(
    @Param('roundId') roundId: string,
    @Body(new ZodValidationPipe(salvarSlipSchema)) body: SalvarSlip,
    @Req() req: Request,
  ): Promise<{ slipId: string }> {
    return comoHttp(() => this.apostas.salvar(roundId, contaDe(req), body));
  }

  /** "Submeter pagamento" (D-27): congela o rascunho e devolve o total a depositar. */
  @Post('slip/submeter')
  @HttpCode(200)
  submeter(
    @Param('roundId') roundId: string,
    @Body(new ZodValidationPipe(submeterSlipSchema)) body: SubmeterSlip,
    @Req() req: Request,
  ): Promise<{ total: number }> {
    return comoHttp(() => this.apostas.submeter(roundId, contaDe(req), body));
  }
}
