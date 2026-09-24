import { Injectable } from '@nestjs/common';
import { TitanBetRepository } from './titan-bet.repository';

/**
 * "Esta conta pode apostar nesta rodada?" — pelo snapshot congelado no Ready,
 * nunca pela fonte externa (D-32, D-38).
 *
 * É autorização **de domínio**, separada do guard de acesso ao site.
 */
@Injectable()
export class ElegibilidadeService {
  constructor(private readonly repo: TitanBetRepository) {}

  /**
   * O personagem do snapshot que torna a conta elegível, ou `null`.
   *
   * Com mais de um personagem da conta no snapshot, vale o de melhor rank — o
   * mesmo critério do personagem que representa a conta na sessão
   * (`SessionUser.matchedCharacter`). É o que o slip grava como
   * `eligibilityCharacterId`.
   *
   * Sem nenhum ligado à conta — quem saiu da guilda depois do Ready —, vale o
   * de um slip da conta nesta rodada (D-53a, D-65). Quem saiu antes de ter slip
   * não tem mais como ser reconhecido: é o limite registrado da D-53a.
   */
  async personagemDeElegibilidade(roundId: string, userId: string): Promise<string | null> {
    const [melhor] = await this.repo.personagensDaContaNoSnapshot(roundId, userId);
    if (melhor) return melhor.characterId;
    return this.repo.elegibilidadeDeSlipDaConta(roundId, userId);
  }
}
