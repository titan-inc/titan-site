import { randomUUID } from 'node:crypto';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ApostasService, ContaNaoElegivel } from '../../../src/titan-bet/apostas.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { depositante, Fabrica } from './fabrica';

/**
 * Milestone "RED/GREEN Autorização" — o lado do dado (D-21, D-32, D-36, D-38).
 * titan-bet-test-design.md §3.9. O lado HTTP (401/403 por guard) está em
 * `src/titan-bet/titan-bet.controller.spec.ts`.
 */
jest.setTimeout(30_000);

describe('Titan Bet — o próprio dado, e só ele (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let apostas: ApostasService;
  let deposito: DepositoService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    const repo = new TitanBetRepository(db);
    apostas = new ApostasService(
      repo,
      new ElegibilidadeService(repo),
      new CharactersRepository(db),
    );
    deposito = new DepositoService(repo);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function conta(tag: string, personagens: Array<[{ id: string }, number]>) {
    const user = await db.user.create({
      data: { battlenetId: randomUUID(), battletag: tag, membership: 'member' },
    });
    for (const [pj, rank] of personagens) {
      await db.guildCharacter.create({ data: { userId: user.id, characterId: pj.id, rank } });
    }
    return { userId: user.id, battletag: user.battletag };
  }

  /** Rodada aberta com duas contas no snapshot de bettors e uma da guilda fora dele. */
  async function cenario() {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');

    const pjA = await f.personagem();
    const pjB = await f.personagem();
    const pjFora = await f.personagem();
    await f.bettor(rodada.id, pjA.id);
    await f.bettor(rodada.id, pjB.id);
    await f.candidato(rodada.id, pjA.id, 'Melee');
    await f.pronta(rodada.id);

    const a = await conta('ContaA#1', [[pjA, 4]]);
    const b = await conta('ContaB#1', [[pjB, 5]]);
    // Da guilda hoje — tem personagem no roster —, mas não estava no Ready.
    const fora = await conta('Fora#1', [[pjFora, 4]]);
    return { rodada, topDps, pjA, pjB, a, b, fora };
  }

  describe('T-Z02 — membro não lê slip de outro (D-21, D-36)', () => {
    it('A tem o próprio slip; B, sem slip, não recebe o de A', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.a, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.pjA.id }],
      });

      const deA = await apostas.meuSlip(c.rodada.id, c.a.userId);
      expect(deA?.status).toBe('rascunho');
      expect(deA?.apostas).toEqual([
        { marketId: c.topDps.id, stake: 300, targetCharacterId: c.pjA.id },
      ]);

      expect(await apostas.meuSlip(c.rodada.id, c.b.userId)).toBeNull();
    });

    it('com os dois tendo slip, cada um lê o seu', async () => {
      const c = await cenario();
      const { slipId: slipA } = await apostas.salvar(c.rodada.id, c.a, { apostas: [] });
      const { slipId: slipB } = await apostas.salvar(c.rodada.id, c.b, { apostas: [] });

      expect((await apostas.meuSlip(c.rodada.id, c.a.userId))?.slipId).toBe(slipA);
      expect((await apostas.meuSlip(c.rodada.id, c.b.userId))?.slipId).toBe(slipB);
    });

    it('slip recusado continua legível pelo dono, com o motivo (D-34)', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.a, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.pjA.id }],
      });
      await apostas.submeter(c.rodada.id, c.a, depositante(c.pjA));
      const [slip] = await db.betSlip.findMany({ where: { ownerUserId: c.a.userId } });
      await deposito.recusar(slip!.id, { userId: 'officer', battletag: 'Officer#1' }, 'faltou');

      const lido = await apostas.meuSlip(c.rodada.id, c.a.userId);
      expect(lido).toMatchObject({ status: 'recusado', rejectionReason: 'faltou' });
    });
  });

  describe('T-Z03 — conta fora do snapshot não aposta (D-32, D-38)', () => {
    it('conta da guilda hoje, fora do snapshot de bettors → ContaNaoElegivel, nada gravado', async () => {
      const c = await cenario();
      await expect(apostas.salvar(c.rodada.id, c.fora, { apostas: [] })).rejects.toBeInstanceOf(
        ContaNaoElegivel,
      );
      expect(await db.betSlip.count({ where: { ownerUserId: c.fora.userId } })).toBe(0);
    });
  });

  describe('T-D01 no banco — depósitos pendentes montados só de BetSlip (§16.9)', () => {
    it('lista o pendente com dono, depositante e total; rascunho não aparece', async () => {
      const c = await cenario();
      await apostas.salvar(c.rodada.id, c.a, {
        apostas: [{ marketId: c.topDps.id, stake: 300, targetCharacterId: c.pjA.id }],
      });
      await apostas.submeter(c.rodada.id, c.a, depositante(c.pjA));
      await apostas.salvar(c.rodada.id, c.b, { apostas: [] });

      const { depositos } = await deposito.pendentes(c.rodada.id);
      const pj = await db.character.findUniqueOrThrow({ where: { id: c.pjA.id } });

      expect(depositos).toHaveLength(1);
      expect(depositos[0]).toEqual({
        slipId: expect.any(String) as string,
        ownerBattletag: 'ContaA#1',
        depositCharacter: { name: pj.name, realm: pj.realm },
        expectedTotal: 300,
        status: 'aguardando_deposito',
        submittedAt: expect.any(String) as string,
      });
    });
  });
});
