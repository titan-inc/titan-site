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
  escolherFonteSchema,
  prepararRodadaSchema,
  recusarDepositoSchema,
  sessaoDaAuditoriaSchema,
  type AuditoriaCorrente,
  type CatalogoDeRaid,
  type DepositosPendentes,
  type EscolherFonte,
  type PreparacaoDaRodada,
  type PrepararRodada,
  type RecusarDeposito,
  type SessaoDaAuditoria,
} from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditoriaService } from './auditoria.service';
import { DepositoService } from './deposito.service';
import { comoHttp, contaDe } from './http';
import { PreparacaoService } from './preparacao.service';
import { ReadyService } from './ready.service';

/**
 * O Officer Panel do Titan Bet (D-36; spec §16.9): preparação da semana,
 * Ready, depósitos e Auditar.
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
    private readonly auditoria: AuditoriaService,
    private readonly preparacao: PreparacaoService,
  ) {}

  /** Cria a rodada da próxima semana, vazia, em PREPARATION (D-45). */
  @Post('rodadas')
  criarRodada(@Req() req: Request): Promise<{ roundId: string }> {
    return comoHttp(() => this.preparacao.criar(contaDe(req)));
  }

  /** O catálogo de raid do WCL, de onde se escolhem os encounters (D-22). */
  @Get('catalogo')
  catalogo(): Promise<CatalogoDeRaid> {
    return this.preparacao.catalogo();
  }

  @Get('rodadas/:roundId/preparacao')
  async verPreparacao(@Param('roundId') roundId: string): Promise<PreparacaoDaRodada> {
    const vista = await this.preparacao.ver(roundId);
    if (!vista) throw new NotFoundException('A rodada não existe');
    return vista;
  }

  /**
   * A configuração inteira da semana, como está agora (D-45): encounters, track,
   * mercados e Weekly. Pessoas não entram — são do Ready.
   */
  @Put('rodadas/:roundId/preparacao')
  salvarPreparacao(
    @Param('roundId') roundId: string,
    @Body(new ZodValidationPipe(prepararRodadaSchema)) body: PrepararRodada,
    @Req() req: Request,
  ): Promise<PreparacaoDaRodada> {
    return comoHttp(() => this.preparacao.salvar(roundId, body, contaDe(req)));
  }

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

  /** Auditar (D-30): procura os `titanbet*` de terça e quinta e abre uma tentativa. */
  @Post('rodadas/:roundId/auditar')
  auditar(@Param('roundId') roundId: string, @Req() req: Request): Promise<{ auditId: string }> {
    return comoHttp(() => this.auditoria.auditar(roundId, contaDe(req)));
  }

  /** A tentativa corrente, com fontes e candidatos; 404 antes do primeiro Auditar. */
  @Get('rodadas/:roundId/auditoria')
  async auditoriaCorrente(@Param('roundId') roundId: string): Promise<AuditoriaCorrente> {
    const a = await this.auditoria.corrente(roundId);
    if (!a) throw new NotFoundException('A rodada ainda não foi auditada');
    return a;
  }

  /** A escolha do officer numa sessão ambígua (D-25). */
  @Post('auditorias/:auditId/fontes/:session/escolher')
  @HttpCode(204)
  async escolherFonte(
    @Param('auditId') auditId: string,
    @Param('session', new ZodValidationPipe(sessaoDaAuditoriaSchema, 'Sessão'))
    session: SessaoDaAuditoria,
    @Body(new ZodValidationPipe(escolherFonteSchema)) body: EscolherFonte,
    @Req() req: Request,
  ): Promise<void> {
    await comoHttp(() =>
      this.auditoria.escolherFonte(auditId, session, body.reportCode, contaDe(req)),
    );
  }
}
