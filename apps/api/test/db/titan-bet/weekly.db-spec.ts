import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * Weekly Progression por boss (D-54, mudança de produto) e o desfecho
 * `sem_vencedor` (D-61), no banco: T-W14 e T-M17.
 * titan-bet-test-design.md §3.18.
 */
describe('Titan Bet — Weekly por boss e sem_vencedor (banco)', () => {
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

  /** Rodada com um boss farm, um de progressão e a Weekly; slip em rascunho. */
  async function cenario() {
    return f.cenarioDeAposta(['Melee'], async (roundId) => {
      const farm = await f.encounter(roundId, { track: 'farm' });
      return {
        farm,
        prog: await f.encounter(roundId, { track: 'progressao' }),
        weekly: await f.mercadoWeekly(roundId),
        topDps: await f.mercadoDeBoss(farm, 'top_dps'),
      };
    });
  }

  function apostaWeekly(
    c: Awaited<ReturnType<typeof cenario>>,
    data: Partial<Prisma.BetUncheckedCreateInput> = {},
  ) {
    return db.bet.create({
      data: {
        slipId: c.slip.id,
        roundId: c.rodada.id,
        marketId: c.config.weekly.id,
        marketKind: 'weekly_progression',
        stake: 300,
        targetEncounterId: c.config.prog.id,
        targetEncounterTrack: 'progressao',
        ...data,
      },
    });
  }

  describe('T-W14 — a aposta da Weekly escolhe um boss de progressão da rodada (D-54)', () => {
    it('controle: boss de progressão da rodada', async () => {
      const c = await cenario();
      expect(await escrita(apostaWeekly(c))).toBe('aceito');
    });

    it('Weekly sem boss → recusado', async () => {
      const c = await cenario();
      expect(
        await escrita(apostaWeekly(c, { targetEncounterId: null, targetEncounterTrack: null })),
      ).toBe('check');
    });

    it('boss farm → recusado: farm fica fora da Weekly', async () => {
      const c = await cenario();
      expect(
        await escrita(
          apostaWeekly(c, { targetEncounterId: c.config.farm.id, targetEncounterTrack: 'farm' }),
        ),
      ).toBe('check');
    });

    it('boss farm declarado como progressão → recusado pela FK com o track', async () => {
      const c = await cenario();
      expect(await escrita(apostaWeekly(c, { targetEncounterId: c.config.farm.id }))).toBe('fk');
    });

    it('boss de progressão de outra rodada → recusado', async () => {
      const c = await cenario();
      const d = await cenario();
      expect(await escrita(apostaWeekly(c, { targetEncounterId: d.config.prog.id }))).toBe('fk');
    });

    it('mercado de personagem com boss → recusado', async () => {
      const c = await cenario();
      const alvo = Object.values(c.candidatos)[0]!;
      const mercado = c.config.topDps;
      expect(
        await escrita(
          db.bet.create({
            data: {
              slipId: c.slip.id,
              roundId: c.rodada.id,
              marketId: mercado.id,
              marketKind: 'top_dps',
              stake: 300,
              targetCharacterId: alvo.characterId,
              targetRole: alvo.role,
              targetEncounterId: c.config.prog.id,
              targetEncounterTrack: 'progressao',
            },
          }),
        ),
      ).toBe('check');
    });
  });

  describe('T-M17 — desfecho `sem_vencedor` no banco (D-61)', () => {
    async function auditoria(roundId: string) {
      return db.betAudit.create({
        data: {
          roundId,
          attempt: 1,
          status: 'pronta',
          startedByUserId: 'officer-teste',
          startedByBattletag: 'Officer#0001',
        },
      });
    }

    const resultado = (
      c: Awaited<ReturnType<typeof cenario>>,
      auditId: string,
      data: Partial<Prisma.BetMarketResultUncheckedCreateInput>,
    ) =>
      db.betMarketResult.create({
        data: {
          auditId,
          marketId: c.config.weekly.id,
          roundId: c.rodada.id,
          outcome: 'sem_vencedor',
          validPool: 1000,
          prizePool: 900,
          winningStake: 0,
          evidence: { motivo: 'sem_kill' },
          algorithmVersion: 'titanbet-2',
          ...data,
        },
      });

    it('controle: sem vencedor, com V e P e W = 0', async () => {
      const c = await cenario();
      const a = await auditoria(c.rodada.id);
      expect(await escrita(resultado(c, a.id, {}))).toBe('aceito');
    });

    it('sem vencedor com W > 0 → recusado: havia aposta vencedora', async () => {
      const c = await cenario();
      const a = await auditoria(c.rodada.id);
      expect(await escrita(resultado(c, a.id, { winningStake: 300 }))).toBe('check');
    });

    it('sem vencedor sem P → recusado: o P é o que se redistribui', async () => {
      const c = await cenario();
      const a = await auditoria(c.rodada.id);
      expect(await escrita(resultado(c, a.id, { prizePool: null }))).toBe('check');
    });

    it('sem vencedor com motivo de VOID → recusado: não é VOID', async () => {
      const c = await cenario();
      const a = await auditoria(c.rodada.id);
      expect(await escrita(resultado(c, a.id, { voidReason: 'sem_kill' }))).toBe('check');
    });
  });
});
