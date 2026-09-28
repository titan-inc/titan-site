import type { BetAuditStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * Resultado da auditoria no banco (§16.4): T-X01–T-X07 e a metade de banco do
 * T-F06. titan-bet-test-design.md §3.15.
 *
 * Ciclo de vida: rodada preparada → Ready → cutoff → Auditar (`pronta`) →
 * resultados gravados → `calculada` → `confirmada`.
 */
describe('Titan Bet — resultado da auditoria (banco)', () => {
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

  const OFFICER = { startedByUserId: 'officer-teste', startedByBattletag: 'Officer#0001' };

  /** Rodada pronta com um boss, Top DPS e a Weekly, um candidato e uma auditoria. */
  async function cenario(status: BetAuditStatus = 'pronta') {
    const rodada = await f.rodada();
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const weekly = await f.mercadoWeekly(rodada.id);
    const candidato = await f.personagem();
    const outsider = await f.personagem();
    await f.candidato(rodada.id, candidato.id, 'Melee');
    await f.pronta(rodada.id);
    const auditoria = await db.betAudit.create({
      data: { roundId: rodada.id, attempt: 1, status, ...OFFICER },
    });
    return { rodada, boss, topDps, weekly, candidato, outsider, auditoria };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  function resultado(c: Cenario, data: Partial<Prisma.BetMarketResultUncheckedCreateInput> = {}) {
    return db.betMarketResult.create({
      data: {
        auditId: c.auditoria.id,
        marketId: c.topDps.id,
        roundId: c.rodada.id,
        outcome: 'vencedores',
        validPool: 1000,
        prizePool: 900,
        winningStake: 300,
        evidence: { versao: 1 },
        algorithmVersion: 'teste-1',
        ...data,
      },
    });
  }

  const vencedor = (resultId: string, roundId: string, characterId: string) =>
    db.betMarketResultWinner.create({ data: { resultId, roundId, characterId } });

  describe('T-X01 — um resultado por mercado por tentativa', () => {
    it('o segundo resultado do mesmo mercado na mesma auditoria é recusado', async () => {
      const c = await cenario();
      await resultado(c);
      expect(await escrita(resultado(c))).toBe('unique');
    });

    it('controle: outro mercado na mesma auditoria; o mesmo mercado em outra tentativa', async () => {
      const c = await cenario();
      await resultado(c);
      expect(
        await escrita(
          resultado(c, {
            marketId: c.weekly.id,
            validPool: 0,
            prizePool: 0,
            winningStake: 0,
          }),
        ),
      ).toBe('aceito');
      const outra = await db.betAudit.create({
        data: { roundId: c.rodada.id, attempt: 2, status: 'pronta', ...OFFICER },
      });
      expect(await escrita(resultado(c, { auditId: outra.id }))).toBe('aceito');
    });
  });

  describe('T-X02 — auditoria, mercado e resultado são da mesma rodada', () => {
    it('mercado de outra rodada → recusado', async () => {
      const c = await cenario();
      const d = await cenario();
      expect(await escrita(resultado(c, { marketId: d.topDps.id }))).toBe('fk');
    });

    it('auditoria de outra rodada → recusado', async () => {
      const c = await cenario();
      const d = await cenario();
      expect(await escrita(resultado(c, { auditId: d.auditoria.id }))).toBe('fk');
    });
  });

  describe('T-X03 — CHECKs do desfecho (§16.4)', () => {
    it('anulado sem motivo → recusado', async () => {
      const c = await cenario();
      expect(
        await escrita(resultado(c, { outcome: 'anulado', prizePool: null, winningStake: null })),
      ).toBe('check');
    });

    it('vencedores com motivo de VOID → recusado', async () => {
      const c = await cenario();
      expect(await escrita(resultado(c, { voidReason: 'sem_kill' }))).toBe('check');
    });

    it('anulado com P ou W → recusado: VOID não rateia', async () => {
      const c = await cenario();
      expect(await escrita(resultado(c, { outcome: 'anulado', voidReason: 'sem_kill' }))).toBe(
        'check',
      );
    });

    it('vencedores sem P ou W → recusado', async () => {
      const c = await cenario();
      expect(await escrita(resultado(c, { prizePool: null }))).toBe('check');
      expect(await escrita(resultado(c, { winningStake: null }))).toBe('check');
    });

    it('V negativo → recusado', async () => {
      const c = await cenario();
      expect(await escrita(resultado(c, { validPool: -1 }))).toBe('check');
    });

    it('controle: anulado com motivo e sem P/W; vencedores com W = 0 (D-44)', async () => {
      const c = await cenario();
      expect(
        await escrita(
          resultado(c, {
            outcome: 'anulado',
            voidReason: 'sem_kill',
            prizePool: null,
            winningStake: null,
          }),
        ),
      ).toBe('aceito');
      expect(await escrita(resultado(c, { marketId: c.weekly.id, winningStake: 0 }))).toBe(
        'aceito',
      );
    });
  });

  describe('T-X04 — vencedor é candidato do snapshot (D-13)', () => {
    it('outsider como vencedor → recusado', async () => {
      const c = await cenario();
      const r = await resultado(c);
      expect(await escrita(vencedor(r.id, c.rodada.id, c.outsider.id))).toBe('fk');
    });

    it('vencedor com roundId de outra rodada → recusado', async () => {
      const c = await cenario();
      const d = await cenario();
      const r = await resultado(c);
      expect(await escrita(vencedor(r.id, d.rodada.id, d.candidato.id))).toBe('fk');
    });

    it('controle: o candidato vence', async () => {
      const c = await cenario();
      const r = await resultado(c);
      expect(await escrita(vencedor(r.id, c.rodada.id, c.candidato.id))).toBe('aceito');
    });
  });

  describe('T-X05 — kill da Weekly é encounter da rodada', () => {
    it('encounter de outra rodada → recusado', async () => {
      const c = await cenario();
      const d = await cenario();
      const r = await resultado(c, { marketId: c.weekly.id });
      expect(
        await escrita(
          db.betMarketResultKill.create({
            data: { resultId: r.id, roundId: c.rodada.id, roundEncounterId: d.boss.id },
          }),
        ),
      ).toBe('fk');
    });

    it('controle: encounter da rodada', async () => {
      const c = await cenario();
      const r = await resultado(c, { marketId: c.weekly.id });
      expect(
        await escrita(
          db.betMarketResultKill.create({
            data: { resultId: r.id, roundId: c.rodada.id, roundEncounterId: c.boss.id },
          }),
        ),
      ).toBe('aceito');
    });
  });

  describe('T-X06 — resultado nunca muda nem some (T-F06 no banco, D-43)', () => {
    it('UPDATE e DELETE no resultado → recusados', async () => {
      const c = await cenario();
      const r = await resultado(c, { evidence: { parse: 98 } });
      expect(
        await escrita(
          db.betMarketResult.update({ where: { id: r.id }, data: { evidence: { parse: 91 } } }),
        ),
      ).toBe('trigger');
      expect(await escrita(db.betMarketResult.delete({ where: { id: r.id } }))).toBe('trigger');
    });

    it('UPDATE e DELETE em vencedor e kill → recusados', async () => {
      const c = await cenario();
      const r = await resultado(c);
      await vencedor(r.id, c.rodada.id, c.candidato.id);
      expect(
        await escrita(db.betMarketResultWinner.deleteMany({ where: { resultId: r.id } })),
      ).toBe('trigger');
      const w = await resultado(c, { marketId: c.weekly.id });
      await db.betMarketResultKill.create({
        data: { resultId: w.id, roundId: c.rodada.id, roundEncounterId: c.boss.id },
      });
      expect(await escrita(db.betMarketResultKill.deleteMany({ where: { resultId: w.id } }))).toBe(
        'trigger',
      );
    });
  });

  describe('T-X07 — resultado só entra com a auditoria `pronta`', () => {
    it.each(['aguardando_revisao', 'calculada', 'substituida'] as const)(
      'auditoria %s → recusado',
      async (status) => {
        const c = await cenario(status);
        expect(await escrita(resultado(c))).toBe('trigger');
      },
    );

    it('auditoria confirmada → recusado; e o vencedor também', async () => {
      const c = await cenario();
      const r = await resultado(c);
      await db.betAudit.update({
        where: { id: c.auditoria.id },
        data: {
          status: 'confirmada',
          confirmedAt: new Date(),
          confirmedByUserId: 'officer-teste',
          confirmedByBattletag: 'Officer#0001',
        },
      });
      expect(await escrita(resultado(c, { marketId: c.weekly.id }))).toBe('trigger');
      expect(await escrita(vencedor(r.id, c.rodada.id, c.candidato.id))).toBe('trigger');
    });
  });
});
