import { Injectable } from '@nestjs/common';
import type { ApostaDoSlip, MeuSlip, SalvarSlip, SubmeterSlip } from '@titan/shared';
import { candidatosDoMercado } from './candidatos';
import { ElegibilidadeService } from './elegibilidade.service';
import {
  TitanBetRepository,
  type ApostaGravada,
  type ApostaParaGravar,
  type Cardapio,
} from './titan-bet.repository';

/** A aposta foi recusada; nada mudou no slip. */
export class ApostaRecusada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ApostaRecusada';
  }
}

/**
 * A conta não tem personagem no snapshot de bettors da rodada (D-32, D-38).
 *
 * Classe própria porque é outra resposta: é falta de permissão para apostar
 * nesta rodada (403), não aposta malformada (422).
 */
export class ContaNaoElegivel extends ApostaRecusada {
  constructor() {
    super('a conta não tem personagem no snapshot de bettors da rodada');
    this.name = 'ContaNaoElegivel';
  }
}

interface Conta {
  userId: string;
  battletag: string;
}

/**
 * O Bet Slip do membro: Salvar e Submeter pagamento (D-27, D-28).
 *
 * O banco já recusa o que viola a forma (FKs compostas, CHECKs, triggers de
 * cutoff e de edição — spec §16.4). Aqui fica o que é regra de domínio e o que
 * dá uma mensagem melhor que a do banco: a conta ser elegível (D-38), o alvo ser
 * candidato do mercado (D-04), o depositante ser da conta (D-02) e o self-bet
 * no First Death (D-09).
 */
@Injectable()
export class ApostasService {
  constructor(
    private readonly repo: TitanBetRepository,
    private readonly elegibilidade: ElegibilidadeService,
  ) {}

  async salvar(roundId: string, conta: Conta, input: SalvarSlip): Promise<{ slipId: string }> {
    const eligibilityCharacterId = await this.elegibilidade.personagemDeElegibilidade(
      roundId,
      conta.userId,
    );
    if (!eligibilityCharacterId) throw new ContaNaoElegivel();

    const apostas = this.validar(input, await this.repo.cardapio(roundId));

    const resultado = await this.comoRecusa(() =>
      this.repo.salvarRascunho({ roundId, owner: conta, eligibilityCharacterId, apostas }),
    );
    if (resultado.tipo === 'nao_editavel') {
      throw new ApostaRecusada(`o slip está ${resultado.status} e não pode mais ser editado`);
    }
    return { slipId: resultado.slipId };
  }

  /**
   * O slip da própria conta na rodada (D-36): o ativo, se houver; senão o mais
   * recente — um recusado continua visível para o dono, com o motivo (D-34).
   * `null` quando a conta não tem slip nesta rodada.
   */
  async meuSlip(roundId: string, userId: string): Promise<MeuSlip | null> {
    const slips = await this.repo.slipsDaConta(roundId, userId);
    const slip = slips.find((s) => ATIVOS.has(s.status)) ?? slips[0];
    if (!slip) return null;
    return {
      slipId: slip.id,
      status: slip.status,
      apostas: slip.bets.map((b): ApostaDoSlip =>
        b.marketKind === 'weekly_progression'
          ? { marketId: b.marketId, stake: b.stake, encounterId: b.targetEncounterId! }
          : { marketId: b.marketId, stake: b.stake, targetCharacterId: b.targetCharacterId! },
      ),
      depositCharacterId: slip.depositCharacterId,
      expectedTotal: slip.expectedTotal,
      rejectionReason: slip.rejectionReason,
    };
  }

  async submeter(roundId: string, conta: Conta, input: SubmeterSlip): Promise<{ total: number }> {
    if (!(await this.repo.personagemEDaConta(conta.userId, input.depositCharacterId))) {
      throw new ApostaRecusada('o personagem depositante não é da conta');
    }

    const resultado = await this.comoRecusa(() =>
      this.repo.submeterRascunho({
        roundId,
        userId: conta.userId,
        depositCharacterId: input.depositCharacterId,
        agora: new Date(),
        avaliar: (apostas) => avaliarSubmissao(apostas, input.depositCharacterId),
      }),
    );
    if (resultado.tipo === 'sem_rascunho') {
      throw new ApostaRecusada('não há slip em rascunho para submeter');
    }
    if (resultado.tipo === 'recusado') throw new ApostaRecusada(resultado.motivo);
    return { total: resultado.total };
  }

  /** Cada aposta contra o cardápio da rodada; devolve o que gravar. */
  private validar(input: SalvarSlip, cardapio: Cardapio): ApostaParaGravar[] {
    const mercados = new Map(cardapio.markets.map((m) => [m.id, m]));
    // As opções da Weekly são os bosses de progressão da rodada (D-54).
    const daWeekly = new Set(
      cardapio.encounters.filter((e) => e.track === 'progressao').map((e) => e.id),
    );

    return input.apostas.map((a) => {
      const mercado = mercados.get(a.marketId);
      if (!mercado) throw new ApostaRecusada(`mercado ${a.marketId} não é desta rodada`);

      if (mercado.kind === 'weekly_progression') {
        if (!('encounterId' in a)) {
          throw new ApostaRecusada('a Weekly Progression aposta num boss de progressão');
        }
        if (!daWeekly.has(a.encounterId)) {
          throw new ApostaRecusada('o boss não é de progressão desta rodada');
        }
        return {
          marketId: a.marketId,
          marketKind: mercado.kind,
          stake: a.stake,
          alvo: null,
          boss: a.encounterId,
        };
      }

      if (!('targetCharacterId' in a)) {
        throw new ApostaRecusada('mercado de escolha simples aposta num personagem');
      }
      const alvo = candidatosDoMercado(mercado.kind, cardapio.candidatos).find(
        (c) => c.characterId === a.targetCharacterId,
      );
      if (!alvo) throw new ApostaRecusada('o alvo não é candidato deste mercado');
      return {
        marketId: a.marketId,
        marketKind: mercado.kind,
        stake: a.stake,
        alvo,
        boss: null,
      };
    });
  }

  /** O que o banco recusa (cutoff, trigger, constraint) vira recusa de aposta. */
  private async comoRecusa<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro: unknown) {
      if (erro instanceof ApostaRecusada) throw erro;
      throw new ApostaRecusada(erro instanceof Error ? erro.message : String(erro));
    }
  }
}

/** Os status do slip ativo — os do índice parcial `BetSlip_um_ativo_por_conta`. */
const ATIVOS = new Set<string>(['rascunho', 'aguardando_deposito', 'valido']);

/**
 * O que pode ser submetido, e o total a depositar.
 *
 * Self-bet (D-09): o First Death no próprio personagem depositante é proibido
 * em qualquer resposta da OQ-27a — é o único caso aplicado aqui.
 */
export function avaliarSubmissao(
  apostas: ApostaGravada[],
  depositCharacterId: string,
): { total: number } | { recusa: string } {
  if (apostas.length === 0) return { recusa: 'o slip não tem nenhuma aposta' };
  const selfBet = apostas.some(
    (a) => a.marketKind === 'first_death' && a.targetCharacterId === depositCharacterId,
  );
  if (selfBet) return { recusa: 'First Death no próprio personagem não é permitido' };
  return { total: apostas.reduce((soma, a) => soma + a.stake, 0) };
}
