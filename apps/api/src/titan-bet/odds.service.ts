import { Injectable } from '@nestjs/common';
import type { OddsDaRodada } from '@titan/shared';
import { ContaNaoElegivel } from './apostas.service';
import { candidatosDoMercado } from './candidatos';
import { ElegibilidadeService } from './elegibilidade.service';
import { multiplicadorProjetado } from './odds';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * Projected payout de todos os mercados publicados, para o bettor da rodada
 * (R-35, D-36; spec §16.10).
 *
 * Só sai daqui o multiplicador por opção: as somas vêm agregadas do repository
 * (`GROUP BY`), e nenhuma linha de aposta chega a este service.
 *
 * A Weekly Progression fica de fora: listar os conjuntos com aposta publicaria,
 * anonimamente, a seleção privada de alguém — é a OQ-55, em aberto.
 */
@Injectable()
export class OddsService {
  constructor(
    private readonly repo: TitanBetRepository,
    private readonly elegibilidade: ElegibilidadeService,
  ) {}

  async daRodada(roundId: string, userId: string): Promise<OddsDaRodada> {
    if (!(await this.elegibilidade.personagemDeElegibilidade(roundId, userId))) {
      throw new ContaNaoElegivel();
    }

    const [cardapio, somas] = await Promise.all([
      this.repo.cardapio(roundId),
      this.repo.somasValidasPorOpcao(roundId),
    ]);

    const mercados = cardapio.markets
      .filter((m) => m.kind !== 'weekly_progression')
      .map((m) => {
        const doMercado = somas.filter((s) => s.marketId === m.id);
        const pool = doMercado.reduce((total, s) => total + s.soma, 0);
        return {
          marketId: m.id,
          opcoes: candidatosDoMercado(m.kind, cardapio.candidatos).map((c) => ({
            characterId: c.characterId,
            multiplicador: multiplicadorProjetado(
              pool,
              doMercado.find((s) => s.characterId === c.characterId)?.soma ?? 0,
            ),
          })),
        };
      });

    return { roundId, mercados };
  }
}
