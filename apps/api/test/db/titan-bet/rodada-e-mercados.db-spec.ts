import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2B — invariantes de rodada, encounters e mercados.
 * Ver docs/specs/titan-bet-test-design.md §3.1, §3.13 e §7.
 */
describe('Titan Bet — rodada, encounters e mercados (banco)', () => {
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

  describe('T-R13 — uma BetRound por reset (§16.4)', () => {
    it('recusa segunda rodada com o mesmo period', async () => {
      const primeira = await f.rodada();
      expect(await escrita(f.rodada({ period: primeira.period }))).toBe('unique');
    });
  });

  describe('T-R07 — Ready antes do cutoff (D-31)', () => {
    it('controle: Ready antes do cutoff é aceito', async () => {
      const cutoffAt = new Date(Date.now() + 60_000);
      expect(
        await escrita(
          f.rodada({
            cutoffAt,
            readyAt: new Date(cutoffAt.getTime() - 1),
            readyByUserId: 'o',
            readyByBattletag: 'O#1',
          }),
        ),
      ).toBe('aceito');
    });

    it('recusa Ready no instante do cutoff ou depois', async () => {
      const cutoffAt = new Date(Date.now() - 60_000);
      for (const readyAt of [cutoffAt, new Date(cutoffAt.getTime() + 1)]) {
        expect(
          await escrita(
            f.rodada({ cutoffAt, readyAt, readyByUserId: 'o', readyByBattletag: 'O#1' }),
          ),
        ).toBe('check');
      }
    });

    it('recusa Ready sem officer registrado, e officer sem Ready', async () => {
      expect(await escrita(f.rodada({ readyAt: new Date() }))).toBe('check');
      expect(await escrita(f.rodada({ readyByUserId: 'o', readyByBattletag: 'O#1' }))).toBe(
        'check',
      );
    });
  });

  describe('T-R16 — um encounter por boss na rodada (§16.4)', () => {
    it('recusa o mesmo encounterId duas vezes na mesma rodada', async () => {
      const rodada = await f.rodada();
      const primeiro = await f.encounter(rodada.id);
      expect(
        await escrita(
          f.encounter(rodada.id, { encounterId: primeiro.encounterId, track: 'progressao' }),
        ),
      ).toBe('unique');
    });

    it('controle: o mesmo boss em rodadas diferentes é aceito', async () => {
      const a = await f.rodada();
      const b = await f.rodada();
      const boss = await f.encounter(a.id);
      expect(await escrita(f.encounter(b.id, { encounterId: boss.encounterId }))).toBe('aceito');
    });
  });

  describe('T-R14 — forma dos mercados (R-22/R-24, §16.4)', () => {
    it('controle: First Death em boss de progressão e os seis de farm são aceitos', async () => {
      const rodada = await f.rodada();
      const prog = await f.encounter(rodada.id, { track: 'progressao' });
      const farm = await f.encounter(rodada.id, { track: 'farm' });

      expect(await escrita(f.mercadoDeBoss(prog, 'first_death'))).toBe('aceito');
      for (const kind of [
        'top_dps',
        'top_dps_parse',
        'top_hps',
        'top_hps_parse',
        'top_dispels',
        'first_death',
      ] as const) {
        expect(await escrita(f.mercadoDeBoss(farm, kind))).toBe('aceito');
      }
    });

    it('recusa mercado que não é First Death em boss de progressão', async () => {
      const rodada = await f.rodada();
      const prog = await f.encounter(rodada.id, { track: 'progressao' });
      expect(await escrita(f.mercadoDeBoss(prog, 'top_dps'))).toBe('check');
    });

    it('recusa mercado cujo track não é o do encounter', async () => {
      const rodada = await f.rodada();
      const prog = await f.encounter(rodada.id, { track: 'progressao' });
      expect(
        await escrita(
          db.betMarket.create({
            data: f.mercadoDeBossDados(prog, 'top_dps', { track: 'farm' }),
          }),
        ),
      ).toBe('fk');
    });

    it('recusa mercado de boss sem boss, e Weekly com boss', async () => {
      const rodada = await f.rodada();
      const farm = await f.encounter(rodada.id);
      expect(
        await escrita(
          db.betMarket.create({
            data: f.mercadoDeBossDados(farm, 'top_dps', { roundEncounterId: null, track: null }),
          }),
        ),
      ).toBe('check');
      expect(
        await escrita(
          db.betMarket.create({
            data: f.mercadoWeeklyDados(rodada.id, { roundEncounterId: farm.id, track: 'farm' }),
          }),
        ),
      ).toBe('check');
    });

    it('recusa o mesmo mercado duas vezes para o mesmo boss', async () => {
      const rodada = await f.rodada();
      const farm = await f.encounter(rodada.id);
      await f.mercadoDeBoss(farm, 'top_dps');
      expect(await escrita(f.mercadoDeBoss(farm, 'top_dps'))).toBe('unique');
    });

    it('recusa segunda Weekly Progression na mesma rodada', async () => {
      const rodada = await f.rodada();
      await f.mercadoWeekly(rodada.id);
      expect(await escrita(f.mercadoWeekly(rodada.id))).toBe('unique');
    });

    it('recusa mercado apontando para encounter de outra rodada', async () => {
      const a = await f.rodada();
      const b = await f.rodada();
      const deA = await f.encounter(a.id);
      expect(
        await escrita(
          db.betMarket.create({ data: f.mercadoDeBossDados(deA, 'top_dps', { roundId: b.id }) }),
        ),
      ).toBe('fk');
    });
  });

  describe('T-F07 — não existe mercado por noite (guarda de regressão, sem RED)', () => {
    it('BetMarket não tem coluna de sessão, noite ou data', async () => {
      const colunas = await db.$queryRaw<Array<{ nome: string }>>`
        SELECT column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'BetMarket'`;
      const nomes = colunas.map((c) => c.nome.toLowerCase());
      expect(nomes.length).toBeGreaterThan(0);
      expect(nomes.filter((n) => /session|sessao|night|noite|raid|weekday|date/.test(n))).toEqual(
        [],
      );
    });
  });
});
