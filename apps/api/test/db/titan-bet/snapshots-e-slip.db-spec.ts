import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2B — snapshots de bettors e candidatos, e o Bet Slip.
 * Ver docs/specs/titan-bet-test-design.md §3.2, §3.13 e §7.
 */
describe('Titan Bet — snapshots e slip (banco)', () => {
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

  describe('T-B08 / T-K03 — um personagem por snapshot (§16.4)', () => {
    it('recusa o mesmo personagem duas vezes no snapshot de bettors', async () => {
      const rodada = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      expect(await escrita(f.bettor(rodada.id, pj.id))).toBe('unique');
    });

    it('recusa o mesmo personagem duas vezes no snapshot de candidatos', async () => {
      const rodada = await f.rodada();
      const pj = await f.personagem();
      await f.candidato(rodada.id, pj.id, 'Heal');
      expect(await escrita(f.candidato(rodada.id, pj.id, 'Melee'))).toBe('unique');
    });

    it('controle: o mesmo personagem em rodadas diferentes é aceito', async () => {
      const a = await f.rodada();
      const b = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(a.id, pj.id);
      await f.candidato(a.id, pj.id, 'Heal');
      expect(await escrita(f.bettor(b.id, pj.id))).toBe('aceito');
      expect(await escrita(f.candidato(b.id, pj.id, 'Tank'))).toBe('aceito');
    });
  });

  describe('T-B04 — a elegibilidade do slip vem do snapshot da mesma rodada (D-38)', () => {
    it('controle: personagem do snapshot da rodada é aceito', async () => {
      const rodada = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      expect(await escrita(f.slip(rodada.id, pj.id))).toBe('aceito');
    });

    it('recusa personagem que não está no snapshot', async () => {
      const rodada = await f.rodada();
      const fora = await f.personagem();
      expect(await escrita(f.slip(rodada.id, fora.id))).toBe('fk');
    });

    it('recusa personagem que está no snapshot de outra rodada', async () => {
      const a = await f.rodada();
      const b = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(a.id, pj.id);
      expect(await escrita(f.slip(b.id, pj.id))).toBe('fk');
    });
  });

  describe('T-S02 / T-B05 — no máximo um slip ativo por conta e rodada (D-34)', () => {
    async function rodadaComBettor() {
      const rodada = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      return { rodada, pj };
    }

    it.each([
      ['rascunho', 'rascunho'],
      ['aguardando_deposito', 'rascunho'],
      ['valido', 'rascunho'],
      ['rascunho', 'aguardando_deposito'],
    ] as const)('recusa %s + %s na mesma conta', async (primeiro, segundo) => {
      const { rodada, pj } = await rodadaComBettor();
      await f.slip(rodada.id, pj.id, primeiro);
      expect(await escrita(f.slip(rodada.id, pj.id, segundo))).toBe('unique');
    });

    it('recusa dois ativos da mesma conta por personagens de elegibilidade diferentes', async () => {
      const { rodada, pj } = await rodadaComBettor();
      const alt = await f.personagem();
      await f.bettor(rodada.id, alt.id);
      await f.slip(rodada.id, pj.id);
      expect(await escrita(f.slip(rodada.id, alt.id))).toBe('unique');
    });

    it('controle: recusado não conta — novo rascunho é aceito', async () => {
      const { rodada, pj } = await rodadaComBettor();
      await f.slip(rodada.id, pj.id, 'recusado');
      expect(await escrita(f.slip(rodada.id, pj.id))).toBe('aceito');
    });

    it('controle: dois recusados e um válido na mesma conta são aceitos', async () => {
      const { rodada, pj } = await rodadaComBettor();
      await f.slip(rodada.id, pj.id, 'recusado');
      await f.slip(rodada.id, pj.id, 'recusado');
      expect(await escrita(f.slip(rodada.id, pj.id, 'valido'))).toBe('aceito');
    });

    it('controle: expirado não conta', async () => {
      const { rodada, pj } = await rodadaComBettor();
      await f.slip(rodada.id, pj.id, 'expirado');
      expect(await escrita(f.slip(rodada.id, pj.id))).toBe('aceito');
    });

    it('controle: contas diferentes têm um ativo cada', async () => {
      const { rodada, pj } = await rodadaComBettor();
      await f.slip(rodada.id, pj.id);
      expect(await escrita(f.slip(rodada.id, pj.id, 'rascunho', { ownerUserId: 'outra' }))).toBe(
        'aceito',
      );
    });
  });

  describe('T-S17 — campos obrigatórios por estado (§16.4)', () => {
    async function rodadaComBettor() {
      const rodada = await f.rodada();
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      return { rodada, pj };
    }

    it.each([
      ['aguardando_deposito', { expectedTotal: null }],
      ['aguardando_deposito', { submittedAt: null }],
      ['aguardando_deposito', { depositCharacterId: null }],
      ['valido', { validatedAt: null }],
      ['valido', { validatedByUserId: null }],
      ['recusado', { rejectedAt: null }],
      ['recusado', { rejectionReason: null }],
      ['recusado', { submittedAt: null }],
      ['expirado', { expiredAt: null }],
    ] as const)('recusa %s com %o', async (status, faltando) => {
      const { rodada, pj } = await rodadaComBettor();
      expect(
        await escrita(db.betSlip.create({ data: f.slipDados(rodada.id, pj.id, status, faltando) })),
      ).toBe('check');
    });

    it('recusa total esperado zero', async () => {
      const { rodada, pj } = await rodadaComBettor();
      expect(
        await escrita(
          db.betSlip.create({
            data: f.slipDados(rodada.id, pj.id, 'aguardando_deposito', { expectedTotal: 0 }),
          }),
        ),
      ).toBe('check');
    });
  });
});
