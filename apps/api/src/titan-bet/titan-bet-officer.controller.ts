import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  recusarDepositoSchema,
  type DepositosPendentes,
  type RecusarDeposito,
} from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DepositoService } from './deposito.service';
import { comoHttp, contaDe } from './http';
import { ReadyService } from './ready.service';

/**
 * O Officer Panel do Titan Bet (D-36; spec §16.9).
 *
 * `OfficerGuard` no **controller**, não por rota: toda rota daqui é de officer,
 * e uma rota nova que esquecesse o decorator seria o Officer Panel aberto a
 * qualquer membro. O que o front esconde é UX (Regra 5).
 *
 * Ações de officer não vão para `internal/ops`: ops é automação sem
 * identidade, e confirmar, recusar e dar Ready exigem officer responsável
 * (D-11, Regra 8).
 */
@Controller('internal/titan-bet/officer')
@UseGuards(OfficerGuard)
export class TitanBetOfficerController {
  constructor(
    private readonly ready: ReadyService,
    private readonly deposito: DepositoService,
  ) {}

  /** Ready (D-31): congela a configuração e abre as apostas. */
  @Post('rodadas/:roundId/ready')
  @HttpCode(204)
  async darReady(@Param('roundId') roundId: string, @Req() req: Request): Promise<void> {
    await comoHttp(() => this.ready.ready(roundId, contaDe(req)));
  }

  /** O que conferir no Guild Bank — sem as apostas (§16.9). */
  @Get('rodadas/:roundId/depositos')
  depositos(@Param('roundId') roundId: string): Promise<DepositosPendentes> {
    return this.deposito.pendentes(roundId);
  }

  @Post('slips/:slipId/confirmar')
  @HttpCode(204)
  async confirmar(@Param('slipId') slipId: string, @Req() req: Request): Promise<void> {
    await comoHttp(() => this.deposito.confirmar(slipId, contaDe(req)));
  }

  /** Recusa terminal, com motivo (D-34). */
  @Post('slips/:slipId/recusar')
  @HttpCode(204)
  async recusar(
    @Param('slipId') slipId: string,
    @Body(new ZodValidationPipe(recusarDepositoSchema)) body: RecusarDeposito,
    @Req() req: Request,
  ): Promise<void> {
    await comoHttp(() => this.deposito.recusar(slipId, contaDe(req), body.motivo));
  }
}
