import { Injectable } from '@nestjs/common';
import type { OddsDaRodada } from '@titan/shared';
import { candidatosDoMercado } from './candidatos';
import { multiplicadorProjetado } from './odds';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * Projected payout de todos os mercados publicados (R-35, D-36; spec §16.10).
 *
 * Não depende de conta: membro da guilda fora do snapshot também vê mercados e
 * odds (D-53b) — quem decide quem chega aqui é o guard da rota.
 *
 * Só sai daqui o multiplicador por opção: as somas vêm agregadas do repository
 * (`GROUP BY`), e nenhuma linha de aposta chega a este service.
 *
 * A Weekly Progression entra com uma odd por boss de progressão (D-54) — a
 * soma por boss é agregada, como a por candidato.
 */
@Injectable()
export class OddsService {
  constructor(private readonly repo: TitanBetRepository) {}

  /**
   * `null` quando a rodada não existe ou ainda não teve Ready: as odds seguem a
   * publicação, como a leitura da rodada (D-75) — preparação não é publicada.
   */
  async daRodada(roundId: string): Promise<OddsDaRodada | null> {
    if (!(await this.repo.rodadaPublicada(roundId))) return null;
    const [cardapio, somas] = await Promise.all([
      this.repo.cardapio(roundId),
      this.repo.somasValidasPorOpcao(roundId),
    ]);

    const mercados = cardapio.markets.map((m) => {
      const doMercado = somas.filter((s) => s.marketId === m.id);
      const pool = doMercado.reduce((total, s) => total + s.soma, 0);
      const naOpcao = (opcao: string) =>
        multiplicadorProjetado(pool, doMercado.find((s) => s.opcao === opcao)?.soma ?? 0);

      // Weekly (D-54): uma odd por boss de progressão, como as dos candidatos.
      if (m.kind === 'weekly_progression') {
        return {
          marketId: m.id,
          opcoes: cardapio.encounters
            .filter((e) => e.track === 'progressao')
            .map((e) => ({ roundEncounterId: e.id, multiplicador: naOpcao(e.id) })),
        };
      }
      return {
        marketId: m.id,
        opcoes: candidatosDoMercado(m.kind, cardapio.candidatos).map((c) => ({
          characterId: c.characterId,
          multiplicador: naOpcao(c.characterId),
        })),
      };
    });

    return { roundId, mercados };
  }
}
