import type { BetCandidateRole, BetMarket, BetRound, BetSlip, Character } from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { Relogio } from '../../../src/titan-bet/relogio';
import type { Fabrica } from './fabrica';

/**
 * Dados montados na ordem do ciclo de vida real (§5.3 da spec), para os testes
 * de imutabilidade (M2C):
 *
 *   PREPARATION → encounters e mercados → snapshots → Ready → slips e apostas
 *
 * O Ready aqui é só o `UPDATE` de `readyAt`, que é a parte que o banco vê. O
 * workflow do Ready (leitura das fontes, validação) é de outro milestone.
 */

const OFFICER = { readyByUserId: 'officer-teste', readyByBattletag: 'Officer#0001' };

export interface RodadaAberta {
  rodada: BetRound;
  farm: { id: string; roundId: string; track: 'farm' };
  /** Boss de progressão: a opção da Weekly (D-54). */
  prog: { id: string; roundId: string; track: 'progressao' };
  topDispels: BetMarket;
  weekly: BetMarket;
  dono: Character;
  candidatos: Record<BetCandidateRole, string>;
}

export class Ciclo {
  constructor(
    private readonly db: PrismaService,
    private readonly f: Fabrica,
  ) {}

  /** Rodada em PREPARATION, com o cutoff pedido (padrão: 2 dias). */
  preparacao(cutoffEmMs = 48 * 60 * 60 * 1000) {
    return this.f.rodada({ cutoffAt: new Date(Date.now() + cutoffEmMs) });
  }

  ready(roundId: string) {
    return this.db.betRound.update({
      where: { id: roundId },
      data: { readyAt: new Date(), ...OFFICER },
    });
  }

  /**
   * Rodada aberta, pronta para receber slips: um boss farm com Top Dispels, um
   * boss de progressão, a Weekly Progression, um bettor e um candidato de cada
   * role.
   */
  async aberta(cutoffEmMs?: number): Promise<RodadaAberta> {
    const rodada = await this.preparacao(cutoffEmMs);
    const farm = await this.f.encounter(rodada.id, { track: 'farm' });
    const topDispels = await this.f.mercadoDeBoss(farm, 'top_dispels');
    const prog = await this.f.encounter(rodada.id, { track: 'progressao' });
    const weekly = await this.f.mercadoWeekly(rodada.id);

    const dono = await this.f.personagem();
    await this.f.bettor(rodada.id, dono.id);

    const candidatos = {} as Record<BetCandidateRole, string>;
    for (const role of ['Tank', 'Melee', 'Heal', 'Ranged'] as const) {
      const pj = await this.f.personagem();
      await this.f.candidato(rodada.id, pj.id, role);
      candidatos[role] = pj.id;
    }

    return {
      rodada: await this.ready(rodada.id),
      farm: { id: farm.id, roundId: farm.roundId, track: 'farm' },
      prog: { id: prog.id, roundId: prog.roundId, track: 'progressao' },
      topDispels,
      weekly,
      dono,
      candidatos,
    };
  }

  /** Slip em rascunho do dono, com uma aposta em Top Dispels no Tank. */
  async slipComAposta(r: RodadaAberta, ownerUserId = 'conta-dona') {
    const slip = await this.f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId });
    const aposta = await this.db.bet.create({
      data: {
        slipId: slip.id,
        roundId: r.rodada.id,
        marketId: r.topDispels.id,
        marketKind: 'top_dispels',
        stake: 500,
        targetCharacterId: r.candidatos.Tank,
        targetRole: 'Tank',
      },
    });
    return { slip, aposta };
  }

  /** "Submeter pagamento": rascunho → aguardando_deposito, com o que congela. */
  submeter(slip: BetSlip, total = 500) {
    return this.db.betSlip.update({
      where: { id: slip.id },
      data: {
        status: 'aguardando_deposito',
        submittedAt: new Date(),
        expectedTotal: total,
        depositCharacterId: slip.eligibilityCharacterId,
      },
    });
  }

  confirmar(slipId: string) {
    return this.db.betSlip.update({
      where: { id: slipId },
      data: {
        status: 'valido',
        validatedAt: new Date(),
        validatedByUserId: 'officer-teste',
        validatedByBattletag: 'Officer#0001',
      },
    });
  }

  recusar(slipId: string) {
    return this.db.betSlip.update({
      where: { id: slipId },
      data: {
        status: 'recusado',
        rejectedAt: new Date(),
        rejectedByUserId: 'officer-teste',
        rejectedByBattletag: 'Officer#0001',
        rejectionReason: 'depósito não encontrado no Guild Bank',
      },
    });
  }

  expirar(slipId: string) {
    return this.db.betSlip.update({
      where: { id: slipId },
      data: { status: 'expirado', expiredAt: new Date() },
    });
  }
}

/**
 * Espera o relógio do **servidor** passar de um instante. O cutoff é conferido
 * pelo `now()` do Postgres, e o relógio do container pode não ser o do Node.
 */
export async function esperarPassar(db: PrismaService, instante: Date): Promise<void> {
  for (;;) {
    const [linha] = await db.$queryRaw<Array<{ passou: boolean }>>`
      SELECT now() > ${instante} AS passou`;
    if (linha?.passou) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Um instante depois da janela da auditoria (D-73) de qualquer rodada destes
 * testes: a janela abre na quinta 23:30 depois do cutoff, e o cutoff mais
 * distante aqui é de horas. Os serviços que auditam recebem este relógio — a
 * pré-condição "a raid de quinta já passou" do cenário; o banco segue no
 * `now()` dele.
 */
export const depoisDaQuinta: Relogio = () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
