import { PrismaService } from '../../../src/prisma/prisma.service';
import { Ciclo } from './ciclo';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2C — configuração, snapshots e a própria rodada congelam no Ready (D-31).
 * Ver docs/specs/titan-bet-test-design.md §3.1, §3.13 e §7.
 */
describe('Titan Bet — imutabilidade da configuração (banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let ciclo: Ciclo;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    ciclo = new Ciclo(db, f);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('T-R01 — não se aposta antes do Ready (D-31)', () => {
    it('recusa slip em rodada em PREPARATION', async () => {
      const rodada = await ciclo.preparacao();
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      expect(await escrita(f.slip(rodada.id, pj.id))).toBe('trigger');
    });

    it('controle: depois do Ready o slip é aceito', async () => {
      const r = await ciclo.aberta();
      expect(await escrita(f.slip(r.rodada.id, r.dono.id))).toBe('aceito');
    });
  });

  describe('T-R03 — configuração imutável depois do Ready (D-31)', () => {
    it('controle: em PREPARATION, encounter e mercado são criados, alterados e apagados', async () => {
      const rodada = await ciclo.preparacao();
      const boss = await f.encounter(rodada.id);
      const mercado = await f.mercadoDeBoss(boss, 'top_dps');
      expect(
        await escrita(
          db.betRoundEncounter.update({ where: { id: boss.id }, data: { encounterName: 'Outro' } }),
        ),
      ).toBe('aceito');
      expect(await escrita(db.betMarket.delete({ where: { id: mercado.id } }))).toBe('aceito');
      expect(await escrita(db.betRoundEncounter.delete({ where: { id: boss.id } }))).toBe('aceito');
    });

    it('recusa criar encounter e mercado depois do Ready', async () => {
      const r = await ciclo.aberta();
      expect(await escrita(f.encounter(r.rodada.id))).toBe('trigger');
      expect(await escrita(f.mercadoDeBoss(r.farm, 'first_death'))).toBe('trigger');
    });

    it('recusa alterar encounter e mercado depois do Ready', async () => {
      const r = await ciclo.aberta();
      expect(
        await escrita(
          db.betRoundEncounter.update({ where: { id: r.farm.id }, data: { encounterName: 'X' } }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betMarket.update({
            where: { id: r.topDispels.id },
            data: { createdByBattletag: 'Outro#1' },
          }),
        ),
      ).toBe('trigger');
    });

    it('recusa apagar encounter e mercado depois do Ready', async () => {
      const rodada = await ciclo.preparacao();
      const semMercado = await f.encounter(rodada.id);
      const boss = await f.encounter(rodada.id);
      const mercado = await f.mercadoDeBoss(boss, 'top_dps');
      await ciclo.ready(rodada.id);
      expect(await escrita(db.betMarket.delete({ where: { id: mercado.id } }))).toBe('trigger');
      expect(await escrita(db.betRoundEncounter.delete({ where: { id: semMercado.id } }))).toBe(
        'trigger',
      );
    });
  });

  describe('T-R09 — snapshots só nascem antes do Ready e nunca mudam (D-32, D-33)', () => {
    it('controle: em PREPARATION, bettor e candidato são gravados', async () => {
      const rodada = await ciclo.preparacao();
      const a = await f.personagem();
      const b = await f.personagem();
      expect(await escrita(f.bettor(rodada.id, a.id))).toBe('aceito');
      expect(await escrita(f.candidato(rodada.id, b.id, 'Heal'))).toBe('aceito');
    });

    it('recusa gravar bettor e candidato depois do Ready', async () => {
      const r = await ciclo.aberta();
      const novo = await f.personagem();
      expect(await escrita(f.bettor(r.rodada.id, novo.id))).toBe('trigger');
      expect(await escrita(f.candidato(r.rodada.id, novo.id, 'Melee'))).toBe('trigger');
    });

    it('recusa alterar bettor e candidato, antes e depois do Ready', async () => {
      const rodada = await ciclo.preparacao();
      const a = await f.personagem();
      const bettor = await f.bettor(rodada.id, a.id);
      const candidato = await f.candidato(rodada.id, a.id, 'Heal');
      expect(
        await escrita(db.betRoundBettor.update({ where: { id: bettor.id }, data: { rank: 0 } })),
      ).toBe('trigger');
      await ciclo.ready(rodada.id);
      expect(
        await escrita(
          db.betRoundCandidate.update({ where: { id: candidato.id }, data: { role: 'Tank' } }),
        ),
      ).toBe('trigger');
    });

    it('recusa apagar candidato, antes e depois do Ready', async () => {
      const rodada = await ciclo.preparacao();
      const a = await f.personagem();
      const b = await f.personagem();
      const antes = await f.candidato(rodada.id, a.id, 'Heal');
      const depois = await f.candidato(rodada.id, b.id, 'Tank');
      expect(await escrita(db.betRoundCandidate.delete({ where: { id: antes.id } }))).toBe(
        'trigger',
      );
      await ciclo.ready(rodada.id);
      expect(await escrita(db.betRoundCandidate.delete({ where: { id: depois.id } }))).toBe(
        'trigger',
      );
    });
  });

  describe('T-B03 — sair da guilda depois do Ready não apaga o histórico (D-32)', () => {
    it('recusa apagar bettor de rodada pronta', async () => {
      const rodada = await ciclo.preparacao();
      const pj = await f.personagem();
      const bettor = await f.bettor(rodada.id, pj.id);
      await ciclo.ready(rodada.id);
      expect(await escrita(db.betRoundBettor.delete({ where: { id: bettor.id } }))).toBe('trigger');
    });
  });

  describe('T-R18 — a rodada não desfaz o Ready nem move o cutoff (D-31, §16.2)', () => {
    it('controle: o Ready grava readyAt uma vez', async () => {
      const rodada = await ciclo.preparacao();
      expect(await escrita(ciclo.ready(rodada.id))).toBe('aceito');
    });

    it('recusa desfazer ou reescrever o Ready', async () => {
      const r = await ciclo.aberta();
      expect(
        await escrita(
          db.betRound.update({
            where: { id: r.rodada.id },
            data: { readyAt: null, readyByUserId: null, readyByBattletag: null },
          }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betRound.update({
            where: { id: r.rodada.id },
            data: { readyAt: new Date(Date.now() + 1000), readyByUserId: 'outro' },
          }),
        ),
      ).toBe('trigger');
    });

    it('recusa mover cutoff, abertura ou period — antes e depois do Ready', async () => {
      const rodada = await ciclo.preparacao();
      const depois = new Date(rodada.cutoffAt.getTime() + 60_000);
      expect(
        await escrita(db.betRound.update({ where: { id: rodada.id }, data: { cutoffAt: depois } })),
      ).toBe('trigger');

      const r = await ciclo.aberta();
      expect(
        await escrita(
          db.betRound.update({ where: { id: r.rodada.id }, data: { cutoffAt: depois } }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betRound.update({ where: { id: r.rodada.id }, data: { opensAt: new Date() } }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betRound.update({
            where: { id: r.rodada.id },
            data: { period: r.rodada.period + 1 },
          }),
        ),
      ).toBe('trigger');
    });
  });
});
