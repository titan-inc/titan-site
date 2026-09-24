import { randomInt, randomUUID } from 'node:crypto';
import type {
  BetCandidateRole,
  BetEncounterTrack,
  BetMarketKind,
  BetSlipStatus,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Fábricas de dado **válido** para os testes de banco do Titan Bet.
 *
 * Isolamento por dado (titan-bet-test-design.md §1.2): cada teste cria a sua
 * rodada, com `period` aleatório, e seus próprios personagens. Nada é apagado.
 *
 * Toda linha que sai daqui satisfaz as invariantes da §16.4 da spec — é o que
 * mantém os controles positivos verdes depois do GREEN. Os testes violam **uma**
 * regra de cada vez, sobrescrevendo um campo.
 */

const HORA = 60 * 60 * 1000;
const ATOR = { userId: 'officer-teste', battletag: 'Officer#0001' };

export class Fabrica {
  constructor(private readonly db: PrismaService) {}

  rodadaDados(extra: Partial<Prisma.BetRoundUncheckedCreateInput> = {}) {
    const agora = Date.now();
    return {
      period: randomInt(1, 2_000_000_000),
      opensAt: new Date(agora - 48 * HORA),
      cutoffAt: new Date(agora + 48 * HORA),
      ...extra,
    } satisfies Prisma.BetRoundUncheckedCreateInput;
  }

  rodada(extra: Partial<Prisma.BetRoundUncheckedCreateInput> = {}) {
    return this.db.betRound.create({ data: this.rodadaDados(extra) });
  }

  personagem() {
    const nome = `p${randomUUID().slice(0, 12)}`;
    return this.db.character.create({
      data: { nameKey: nome, realmKey: 'azralon', name: nome, realm: 'Azralon' },
    });
  }

  encounterDados(
    roundId: string,
    extra: Partial<Prisma.BetRoundEncounterUncheckedCreateInput> = {},
  ) {
    return {
      roundId,
      encounterId: randomInt(1, 2_000_000_000),
      encounterName: 'Boss de Teste',
      zoneName: 'Raid de Teste',
      track: 'farm' as BetEncounterTrack,
      createdByUserId: ATOR.userId,
      createdByBattletag: ATOR.battletag,
      ...extra,
    } satisfies Prisma.BetRoundEncounterUncheckedCreateInput;
  }

  encounter(roundId: string, extra: Partial<Prisma.BetRoundEncounterUncheckedCreateInput> = {}) {
    return this.db.betRoundEncounter.create({ data: this.encounterDados(roundId, extra) });
  }

  /** Mercado de boss: copia o `track` do encounter, como a FK composta exigirá. */
  mercadoDeBossDados(
    encounter: { id: string; roundId: string; track: BetEncounterTrack },
    kind: Exclude<BetMarketKind, 'weekly_progression'>,
    extra: Partial<Prisma.BetMarketUncheckedCreateInput> = {},
  ) {
    return {
      roundId: encounter.roundId,
      kind,
      roundEncounterId: encounter.id,
      track: encounter.track,
      createdByUserId: ATOR.userId,
      createdByBattletag: ATOR.battletag,
      ...extra,
    } satisfies Prisma.BetMarketUncheckedCreateInput;
  }

  mercadoDeBoss(
    encounter: { id: string; roundId: string; track: BetEncounterTrack },
    kind: Exclude<BetMarketKind, 'weekly_progression'>,
  ) {
    return this.db.betMarket.create({ data: this.mercadoDeBossDados(encounter, kind) });
  }

  mercadoWeeklyDados(roundId: string, extra: Partial<Prisma.BetMarketUncheckedCreateInput> = {}) {
    return {
      roundId,
      kind: 'weekly_progression' as BetMarketKind,
      roundEncounterId: null,
      track: null,
      createdByUserId: ATOR.userId,
      createdByBattletag: ATOR.battletag,
      ...extra,
    } satisfies Prisma.BetMarketUncheckedCreateInput;
  }

  mercadoWeekly(roundId: string) {
    return this.db.betMarket.create({ data: this.mercadoWeeklyDados(roundId) });
  }

  bettor(roundId: string, characterId: string) {
    return this.db.betRoundBettor.create({
      data: { roundId, characterId, rank: 5, name: 'Bettor', realm: 'Azralon' },
    });
  }

  candidato(roundId: string, characterId: string, role: BetCandidateRole) {
    return this.db.betRoundCandidate.create({
      data: { roundId, characterId, role, name: 'Candidato', realm: 'Azralon' },
    });
  }

  /** Campos obrigatórios de cada estado, preenchidos como o fluxo real faria. */
  slipDados(
    roundId: string,
    eligibilityCharacterId: string,
    status: BetSlipStatus = 'rascunho',
    extra: Partial<Prisma.BetSlipUncheckedCreateInput> = {},
  ) {
    const agora = new Date();
    const submetido = {
      depositCharacterId: eligibilityCharacterId,
      expectedTotal: 500,
      submittedAt: agora,
    };
    const porEstado: Record<BetSlipStatus, Partial<Prisma.BetSlipUncheckedCreateInput>> = {
      rascunho: {},
      aguardando_deposito: submetido,
      valido: {
        ...submetido,
        validatedByUserId: ATOR.userId,
        validatedByBattletag: ATOR.battletag,
        validatedAt: agora,
      },
      recusado: {
        ...submetido,
        rejectedByUserId: ATOR.userId,
        rejectedByBattletag: ATOR.battletag,
        rejectedAt: agora,
        rejectionReason: 'depósito não encontrado no Guild Bank',
      },
      expirado: { expiredAt: agora },
    };
    return {
      roundId,
      ownerUserId: 'conta-dona',
      ownerBattletag: 'Dona#0001',
      eligibilityCharacterId,
      status,
      ...porEstado[status],
      ...extra,
    } satisfies Prisma.BetSlipUncheckedCreateInput;
  }

  slip(
    roundId: string,
    eligibilityCharacterId: string,
    status: BetSlipStatus = 'rascunho',
    extra: Partial<Prisma.BetSlipUncheckedCreateInput> = {},
  ) {
    return this.db.betSlip.create({
      data: this.slipDados(roundId, eligibilityCharacterId, status, extra),
    });
  }

  /** O Ready, do ponto de vista do banco: grava `readyAt` e o officer. */
  pronta(roundId: string) {
    return this.db.betRound.update({
      where: { id: roundId },
      data: { readyAt: new Date(), readyByUserId: ATOR.userId, readyByBattletag: ATOR.battletag },
    });
  }

  /**
   * Uma rodada pronta para receber apostas, montada na ordem do ciclo de vida
   * (§5.3): PREPARATION → configuração → snapshots → Ready → slip em rascunho.
   *
   * `configurar` roda em PREPARATION — é onde o teste cria encounters e
   * mercados, porque depois do Ready a configuração é imutável (D-31).
   */
  async cenarioDeAposta<C = undefined>(
    roles: BetCandidateRole[] = ['Melee', 'Heal', 'Tank'],
    configurar?: (roundId: string) => Promise<C>,
  ) {
    const preparacao = await this.rodada();
    const config = (configurar ? await configurar(preparacao.id) : undefined) as C;

    const dono = await this.personagem();
    await this.bettor(preparacao.id, dono.id);

    const candidatos: Record<string, { characterId: string; role: BetCandidateRole }> = {};
    for (const role of roles) {
      const pj = await this.personagem();
      await this.candidato(preparacao.id, pj.id, role);
      candidatos[role] = { characterId: pj.id, role };
    }

    const rodada = await this.pronta(preparacao.id);
    const slip = await this.slip(rodada.id, dono.id);
    return { rodada, dono, slip, candidatos, config };
  }
}

/** O corpo do Submeter: o depositante por nome + realm, como o membro informa (D-55). */
export function depositante(pj: { name: string; realm: string }) {
  return { depositCharacter: { name: pj.name, realm: pj.realm } };
}
