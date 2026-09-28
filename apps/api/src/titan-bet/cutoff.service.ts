import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * O que o cutoff faz com o que não foi confirmado (D-07, D-35): rascunho e
 * pendente de rodada vencida viram `expirado`.
 *
 * O cutoff é regra, não job (spec §5.5): o banco já recusa criar, editar,
 * submeter, confirmar e recusar depois do `cutoffAt`, com ou sem este job. Ele
 * só materializa o estado. Por isso roda a cada poucos minutos, e não uma vez
 * na terça 12:00: se a instância estiver fora na hora, a próxima rodada pega o
 * atraso sozinha, e rodar de novo não muda nada.
 */
@Injectable()
export class CutoffService {
  private readonly logger = new Logger(CutoffService.name);

  constructor(private readonly repo: TitanBetRepository) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'titan-bet-cutoff' })
  async expirarAgendado(): Promise<void> {
    try {
      await this.expirarVencidos();
    } catch (err: unknown) {
      // Exceção aqui viraria unhandled rejection no @nestjs/schedule.
      this.logger.error(`Cutoff falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async expirarVencidos(): Promise<number> {
    const expirados = await this.repo.expirarVencidos(new Date());
    if (expirados > 0) this.logger.log(`Cutoff: ${expirados} slips expirados`);
    return expirados;
  }
}
