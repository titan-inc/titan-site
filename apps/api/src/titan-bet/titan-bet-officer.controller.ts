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
  ajustarSchema,
  escolherFonteSchema,
  prepararRodadaSchema,
  recusarDepositoSchema,
  sessaoDaAuditoriaSchema,
  type Ajustar,
  type AuditoriaCorrente,
  type CatalogoDeRaid,
  type DepositosPendentes,
  type EscolherFonte,
  type PreparacaoDaRodada,
  type ResultadosDaAuditoria,
  type SaldosDaRodada,
  type PrepararRodada,
  type RecusarDeposito,
  type SessaoDaAuditoria,
} from '@titan/shared';
import type { Request } from 'express';
import { OfficerGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditoriaService } from './auditoria.service';
import { CalculoService } from './calculo.service';
import { LedgerService, SettlementService } from './settlement.service';
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
    private readonly calculo: CalculoService,
    private readonly settlement: SettlementService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Confirma a auditoria calculada — inclusive as propostas de VOID (D-16) — e
   * lança o settlement no ledger, na mesma transação (§16.6).
   */
  @Post('auditorias/:auditId/confirmar')
  @HttpCode(204)
  async confirmarAuditoria(@Param('auditId') auditId: string, @Req() req: Request): Promise<void> {
    await comoHttp(() => this.settlement.confirmar(auditId, contaDe(req)));
  }

  /** O total por membro na rodada: devido e pago (§8.5). */
  @Get('rodadas/:roundId/saldos')
  saldos(@Param('roundId') roundId: string): Promise<SaldosDaRodada> {
    return this.ledger.saldos(roundId);
  }

  /** Marca pago: lança o saldo inteiro da conta do membro (§16.6). */
  @Post('slips/:slipId/pagar')
  @HttpCode(204)
  async pagar(@Param('slipId') slipId: string, @Req() req: Request): Promise<void> {
    await comoHttp(() => this.ledger.pagar(slipId, contaDe(req)));
  }

  /** Corrige com `ajuste`, motivo e referência — nunca reescreve (D-11). */
  @Post('slips/:slipId/ajustes')
  @HttpCode(204)
  async ajustar(
    @Param('slipId') slipId: string,
    @Body(new ZodValidationPipe(ajustarSchema)) body: Ajustar,
    @Req() req: Request,
  ): Promise<void> {
    await comoHttp(() =>
      this.ledger.ajustar(
        {
          slipId,
          amount: body.amount,
          reason: body.reason,
          correctsEntryId: BigInt(body.correctsEntryId),
        },
        contaDe(req),
      ),
    );
  }

  /**
   * Calcula os resultados da tentativa `pronta` com os reports congelados (§7.3).
   * Não confirma nada: VOID é proposta até o officer confirmar (D-16).
   */
  @Post('auditorias/:auditId/calcular')
  @HttpCode(204)
  async calcular(@Param('auditId') auditId: string): Promise<void> {
    await comoHttp(() => this.calculo.calcular(auditId));
  }

  /** Os resultados da tentativa, com a evidência, para revisar antes de confirmar. */
  @Get('auditorias/:auditId/resultados')
  async resultados(@Param('auditId') auditId: string): Promise<ResultadosDaAuditoria> {
    const r = await this.calculo.resultados(auditId);
    if (!r) throw new NotFoundException('A auditoria não existe');
    return r;
  }

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
