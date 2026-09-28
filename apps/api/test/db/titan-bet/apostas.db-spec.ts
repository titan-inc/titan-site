import type { BetMarket, BetMarketKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2B — Bet e Weekly Progression.
 * Ver docs/specs/titan-bet-test-design.md §3.2, §3.13 e §7.
 */
describe('Titan Bet — apostas (banco)', () => {
  let db: PrismaService;
  let f: Fabrica;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Aposta de escolha simples válida; o teste sobrescreve o que quer violar. */
  function apostaSimples(
    slip: { id: string; roundId: string },
    market: { id: string; roundId: string; kind: Prisma.BetUncheckedCreateInput['marketKind'] },
    alvo: { characterId: string; role: NonNullable<Prisma.BetUncheckedCreateInput['targetRole']> },
    extra: Partial<Prisma.BetUncheckedCreateInput> = {},
  ) {
    return db.bet.create({
      data: {
        slipId: slip.id,
        roundId: slip.roundId,
        marketId: market.id,
        marketKind: market.kind,
        stake: 500,
        targetCharacterId: alvo.characterId,
        targetRole: alvo.role,
        ...extra,
      },
    });
  }

  /** Aposta na Weekly: um boss de progressão (D-54). */
  function apostaWeekly(
    slip: { id: string; roundId: string },
    market: { id: string },
    boss: { id: string },
    extra: Partial<Prisma.BetUncheckedCreateInput> = {},
  ) {
    return db.bet.create({
      data: {
        slipId: slip.id,
        roundId: slip.roundId,
        marketId: market.id,
        marketKind: 'weekly_progression',
        stake: 500,
        targetEncounterId: boss.id,
        targetEncounterTrack: 'progressao',
        ...extra,
      },
    });
  }

  type KindDeBoss = Exclude<BetMarketKind, 'weekly_progression'>;

  /**
   * Cenário com um boss farm e os mercados pedidos, criados em PREPARATION —
   * depois do Ready a configuração é imutável (D-31).
   */
  async function cenarioComBoss<K extends KindDeBoss>(
    kinds: K[],
    roles?: Parameters<Fabrica['cenarioDeAposta']>[0],
  ) {
    const c = await f.cenarioDeAposta(roles, async (roundId) => {
      const farm = await f.encounter(roundId);
      const mercados = {} as Record<K, BetMarket>;
      for (const kind of kinds) mercados[kind] = await f.mercadoDeBoss(farm, kind);
      return { farm, mercados };
    });
    return { ...c, farm: c.config.farm, mercados: c.config.mercados };
  }

  /** Cenário com a Weekly Progression e um boss de progressão, em PREPARATION. */
  async function cenarioComWeekly() {
    const c = await f.cenarioDeAposta(undefined, async (roundId) => ({
      weekly: await f.mercadoWeekly(roundId),
      prog: await f.encounter(roundId, { track: 'progressao' }),
    }));
    return { ...c, weekly: c.config.weekly, prog: c.config.prog };
  }

  describe('T-S13 — stake inteiro de 200 a 1.000 (R-16)', () => {
    it('controle: 200 e 1.000 são aceitos', async () => {
      const c = await cenarioComBoss(['top_dps', 'top_dispels']);
      const { top_dps: dps, top_dispels: dispels } = c.mercados;
      expect(await escrita(apostaSimples(c.slip, dps, c.candidatos.Melee!, { stake: 200 }))).toBe(
        'aceito',
      );
      expect(
        await escrita(apostaSimples(c.slip, dispels, c.candidatos.Tank!, { stake: 1000 })),
      ).toBe('aceito');
    });

    it.each([199, 1001, 0, -500])('recusa stake %i', async (stake) => {
      const c = await cenarioComBoss(['top_dps']);
      const { top_dps: dps } = c.mercados;
      expect(await escrita(apostaSimples(c.slip, dps, c.candidatos.Melee!, { stake }))).toBe(
        'check',
      );
    });
  });

  describe('T-S09 — uma Bet por slip e mercado (D-28)', () => {
    it('recusa segunda aposta no mesmo mercado', async () => {
      const c = await cenarioComBoss(['top_dps'], ['Melee', 'Heal', 'Tank', 'Ranged']);
      const { top_dps: dps } = c.mercados;
      await apostaSimples(c.slip, dps, c.candidatos.Melee!);
      expect(await escrita(apostaSimples(c.slip, dps, c.candidatos.Ranged!))).toBe('unique');
    });

    it('recusa segunda aposta na mesma Weekly Progression', async () => {
      const c = await cenarioComWeekly();
      const { weekly } = c;
      await apostaWeekly(c.slip, weekly, c.prog);
      expect(await escrita(apostaWeekly(c.slip, weekly, c.prog, { stake: 300 }))).toBe('unique');
    });
  });

  describe('T-S10 — forma da escolha (D-28)', () => {
    it('recusa escolha simples sem alvo', async () => {
      const c = await cenarioComBoss(['top_dps']);
      const { top_dps: dps } = c.mercados;
      expect(
        await escrita(
          apostaSimples(c.slip, dps, c.candidatos.Melee!, {
            targetCharacterId: null,
            targetRole: null,
          }),
        ),
      ).toBe('check');
    });

    it('recusa Weekly com alvo de personagem', async () => {
      const c = await cenarioComWeekly();
      const { weekly } = c;
      expect(
        await escrita(
          apostaWeekly(c.slip, weekly, c.prog, {
            targetCharacterId: c.candidatos.Melee!.characterId,
            targetRole: 'Melee',
          }),
        ),
      ).toBe('check');
    });

    it('recusa alvo sem role, e role sem alvo', async () => {
      const c = await cenarioComBoss(['top_dispels', 'first_death']);
      const { top_dispels: dispels, first_death: fd } = c.mercados;
      expect(
        await escrita(apostaSimples(c.slip, dispels, c.candidatos.Tank!, { targetRole: null })),
      ).toBe('check');
      expect(
        await escrita(apostaSimples(c.slip, fd, c.candidatos.Tank!, { targetCharacterId: null })),
      ).toBe('check');
    });

    it('recusa marketKind diferente do tipo do mercado', async () => {
      const c = await cenarioComBoss(['top_dispels']);
      const { top_dispels: dispels } = c.mercados;
      expect(
        await escrita(
          apostaSimples(c.slip, dispels, c.candidatos.Tank!, { marketKind: 'first_death' }),
        ),
      ).toBe('fk');
    });
  });

  describe('T-S12 — alvo é candidato da rodada, na role do mercado (D-04, D-33)', () => {
    it('controle: Tank em Top Dispels e em First Death é aceito', async () => {
      const c = await cenarioComBoss(['top_dispels', 'first_death']);
      const { top_dispels: dispels, first_death: fd } = c.mercados;
      expect(await escrita(apostaSimples(c.slip, dispels, c.candidatos.Tank!))).toBe('aceito');
      expect(await escrita(apostaSimples(c.slip, fd, c.candidatos.Tank!))).toBe('aceito');
    });

    it('recusa alvo fora do snapshot de candidatos', async () => {
      const c = await cenarioComBoss(['first_death']);
      const { first_death: fd } = c.mercados;
      const fora = await f.personagem();
      expect(
        await escrita(apostaSimples(c.slip, fd, { characterId: fora.id, role: 'Melee' })),
      ).toBe('fk');
    });

    it('recusa role diferente da congelada no snapshot', async () => {
      const c = await cenarioComBoss(['first_death']);
      const { first_death: fd } = c.mercados;
      expect(
        await escrita(
          apostaSimples(c.slip, fd, { characterId: c.candidatos.Heal!.characterId, role: 'Melee' }),
        ),
      ).toBe('fk');
    });

    it('recusa candidato do snapshot de outra rodada', async () => {
      const c = await cenarioComBoss(['first_death']);
      const outra = await f.cenarioDeAposta();
      const { first_death: fd } = c.mercados;
      expect(await escrita(apostaSimples(c.slip, fd, outra.candidatos.Melee!))).toBe('fk');
    });

    it.each([
      ['top_dps', 'Heal'],
      ['top_dps', 'Tank'],
      ['top_dps_parse', 'Heal'],
      ['top_hps', 'Melee'],
      ['top_hps', 'Tank'],
      ['top_hps_parse', 'Ranged'],
    ] as const)('recusa %s com alvo %s', async (kind, role) => {
      const c = await cenarioComBoss([kind], ['Melee', 'Heal', 'Tank', 'Ranged']);
      const mercado = c.mercados[kind];
      expect(await escrita(apostaSimples(c.slip, mercado, c.candidatos[role]!))).toBe('check');
    });
  });

  describe('T-S14 — nada cruza rodadas (§16.3)', () => {
    it('recusa aposta em mercado de outra rodada', async () => {
      const c = await f.cenarioDeAposta();
      const outra = await f.rodada();
      const farmOutra = await f.encounter(outra.id);
      const dpsOutra = await f.mercadoDeBoss(farmOutra, 'top_dispels');
      expect(await escrita(apostaSimples(c.slip, dpsOutra, c.candidatos.Tank!))).toBe('fk');
    });

    it('recusa aposta com roundId diferente do slip', async () => {
      const c = await f.cenarioDeAposta();
      const outra = await cenarioComBoss(['top_dispels']);
      const { top_dispels: dpsOutra } = outra.mercados;
      expect(
        await escrita(
          apostaSimples(
            { id: c.slip.id, roundId: outra.rodada.id },
            dpsOutra,
            outra.candidatos.Tank!,
          ),
        ),
      ).toBe('fk');
    });
  });

  // Mudança de produto (D-54): T-S11 (Weekly com 0..N bosses marcados) e T-S22
  // (um stake para o conjunto) saíram com o conjunto exato. A forma nova da
  // aposta da Weekly — um boss de progressão da rodada — é o T-W14, em
  // weekly.db-spec.ts.
});
