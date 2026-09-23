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

  function apostaWeekly(
    slip: { id: string; roundId: string },
    market: { id: string },
    extra: Partial<Prisma.BetUncheckedCreateInput> = {},
  ) {
    return db.bet.create({
      data: {
        slipId: slip.id,
        roundId: slip.roundId,
        marketId: market.id,
        marketKind: 'weekly_progression',
        stake: 500,
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

  /** Cenário com a Weekly Progression criada em PREPARATION. */
  async function cenarioComWeekly() {
    const c = await f.cenarioDeAposta(undefined, (roundId) => f.mercadoWeekly(roundId));
    return { ...c, weekly: c.config };
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
      await apostaWeekly(c.slip, weekly);
      expect(await escrita(apostaWeekly(c.slip, weekly, { stake: 300 }))).toBe('unique');
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
          apostaWeekly(c.slip, weekly, {
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

  describe('T-S11 — Weekly Progression: 0..N bosses da mesma rodada, marcados (D-15, D-28)', () => {
    /**
     * Weekly + três bosses marcados (dois farm, um em progressão) e um não
     * marcado, todos criados em PREPARATION.
     */
    async function cenarioWeekly() {
      const c = await f.cenarioDeAposta(undefined, async (roundId) => ({
        weekly: await f.mercadoWeekly(roundId),
        bosses: [
          await f.encounter(roundId),
          await f.encounter(roundId, { track: 'progressao' }),
          await f.encounter(roundId),
        ],
        fora: await f.encounter(roundId, { inWeeklyProgression: false }),
      }));
      const aposta = await apostaWeekly(c.slip, c.config.weekly);
      return { ...c, ...c.config, aposta };
    }

    function selecao(
      aposta: {
        id: string;
        roundId: string;
        marketKind: Prisma.BetUncheckedCreateInput['marketKind'];
      },
      encounter: { id: string; roundId: string; inWeeklyProgression: boolean },
      extra: Partial<Prisma.BetWeeklySelectionUncheckedCreateInput> = {},
    ) {
      return db.betWeeklySelection.create({
        data: {
          betId: aposta.id,
          roundId: aposta.roundId,
          marketKind: aposta.marketKind,
          roundEncounterId: encounter.id,
          inWeeklyProgression: encounter.inWeeklyProgression,
          ...extra,
        },
      });
    }

    it('controle: zero seleções — a aposta em {} existe sozinha', async () => {
      const { aposta } = await cenarioWeekly();
      expect(await db.betWeeklySelection.count({ where: { betId: aposta.id } })).toBe(0);
    });

    it('controle: uma e três seleções são aceitas', async () => {
      const { aposta, bosses } = await cenarioWeekly();
      for (const boss of bosses) expect(await escrita(selecao(aposta, boss))).toBe('aceito');
    });

    it('recusa boss de outra rodada', async () => {
      const { aposta } = await cenarioWeekly();
      const outra = await f.rodada();
      const deOutra = await f.encounter(outra.id);
      expect(await escrita(selecao(aposta, deOutra))).toBe('fk');
    });

    it('recusa boss não marcado para a Weekly, qualquer que seja a flag gravada', async () => {
      const { aposta, fora } = await cenarioWeekly();
      expect(await escrita(selecao(aposta, fora))).toBe('check');
      expect(await escrita(selecao(aposta, fora, { inWeeklyProgression: true }))).toBe('fk');
    });

    it('recusa seleção de boss em aposta que não é Weekly', async () => {
      const c = await cenarioComBoss(['top_dispels']);
      const { farm } = c;
      const { top_dispels: dispels } = c.mercados;
      const aposta = await apostaSimples(c.slip, dispels, c.candidatos.Tank!);
      expect(await escrita(selecao(aposta, farm))).toBe('check');
      expect(await escrita(selecao(aposta, farm, { marketKind: 'weekly_progression' }))).toBe('fk');
    });
  });

  describe('T-S22 — Weekly tem um stake, sem valor por boss (guarda de regressão, sem RED)', () => {
    it('BetWeeklySelection não tem coluna de valor; Bet.stake é obrigatório', async () => {
      const colunas = await db.$queryRaw<Array<{ tabela: string; nome: string; nulo: string }>>`
        SELECT table_name AS tabela, column_name AS nome, is_nullable AS nulo
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('BetWeeklySelection', 'Bet')`;
      const daSelecao = colunas.filter((c) => c.tabela === 'BetWeeklySelection').map((c) => c.nome);
      expect(daSelecao.length).toBeGreaterThan(0);
      expect(daSelecao.filter((n) => /stake|amount|gold|valor/i.test(n))).toEqual([]);
      expect(colunas.find((c) => c.tabela === 'Bet' && c.nome === 'stake')?.nulo).toBe('NO');
    });
  });
});
