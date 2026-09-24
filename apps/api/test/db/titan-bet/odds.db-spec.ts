import { oddsDaRodadaSchema } from '@titan/shared';
import { randomUUID } from 'node:crypto';
import { CharactersRepository } from '../../../src/characters/characters.repository';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ApostasService, ContaNaoElegivel } from '../../../src/titan-bet/apostas.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { ElegibilidadeService } from '../../../src/titan-bet/elegibilidade.service';
import { OddsService } from '../../../src/titan-bet/odds.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { depositante, Fabrica } from './fabrica';

/**
 * Milestone "RED/GREEN Odds" — projected payout (R-35, D-12, D-36; spec §8.4,
 * §16.10). titan-bet-test-design.md §3.5, §3.9.
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — projected payout (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let apostas: ApostasService;
  let deposito: DepositoService;
  let odds: OddsService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    const repo = new TitanBetRepository(db);
    const elegibilidade = new ElegibilidadeService(repo);
    apostas = new ApostasService(repo, elegibilidade, new CharactersRepository(db));
    deposito = new DepositoService(repo);
    odds = new OddsService(repo, elegibilidade);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /**
   * Rodada aberta com Top DPS, First Death e Weekly; candidatos Melee, Ranged e
   * Heal; sete contas no snapshot de bettors, cada uma com o próprio personagem.
   */
  async function cenario() {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const firstDeath = await f.mercadoDeBoss(boss, 'first_death');
    const prog1 = await f.encounter(rodada.id, { track: 'progressao' });
    const prog2 = await f.encounter(rodada.id, { track: 'progressao' });
    const weekly = await f.mercadoWeekly(rodada.id);

    const melee = await f.personagem();
    const ranged = await f.personagem();
    const heal = await f.personagem();
    await f.candidato(rodada.id, melee.id, 'Melee');
    await f.candidato(rodada.id, ranged.id, 'Ranged');
    await f.candidato(rodada.id, heal.id, 'Heal');

    const contas: Array<{
      userId: string;
      battletag: string;
      pj: string;
      dep: ReturnType<typeof depositante>;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const pj = await f.personagem();
      await f.bettor(rodada.id, pj.id);
      const user = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: `Bettor${i}#1`, membership: 'member' },
      });
      await db.guildCharacter.create({ data: { userId: user.id, characterId: pj.id, rank: 5 } });
      contas.push({ userId: user.id, battletag: user.battletag, pj: pj.id, dep: depositante(pj) });
    }
    await f.pronta(rodada.id);

    return { rodada, boss, prog1, prog2, topDps, firstDeath, weekly, melee, ranged, heal, contas };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;
  type Destino = 'rascunho' | 'aguardando_deposito' | 'valido' | 'recusado' | 'expirado';

  /** Uma aposta em Top DPS, levada pelo fluxo real até o status pedido. */
  async function apostar(c: Cenario, i: number, alvo: string, stake: number, destino: Destino) {
    return apostarEm(c, i, { marketId: c.topDps.id, stake, targetCharacterId: alvo }, destino);
  }

  async function apostarEm(
    c: Cenario,
    i: number,
    aposta: Parameters<ApostasService['salvar']>[2]['apostas'][number],
    destino: Destino,
  ) {
    const conta = c.contas[i]!;
    const { slipId } = await apostas.salvar(c.rodada.id, conta, { apostas: [aposta] });
    if (destino === 'rascunho') return;
    if (destino === 'expirado') {
      // O cutoff só expira rodada vencida; aqui, o estado é o que importa.
      await db.betSlip.update({
        where: { id: slipId },
        data: { status: 'expirado', expiredAt: new Date() },
      });
      return;
    }
    await apostas.submeter(c.rodada.id, conta, conta.dep);
    if (destino === 'valido') await deposito.confirmar(slipId, OFFICER);
    if (destino === 'recusado') await deposito.recusar(slipId, OFFICER, 'não achado');
  }

  const opcoesDe = (resposta: Awaited<ReturnType<OddsService['daRodada']>>, marketId: string) =>
    Object.fromEntries(
      resposta.mercados
        .find((m) => m.marketId === marketId)!
        .opcoes.map((o) => [
          'characterId' in o ? o.characterId : o.roundEncounterId,
          o.multiplicador,
        ]),
    );

  describe('T-O02 — só apostas `valido` contam (D-12)', () => {
    it('rascunho, pendente, recusado e expirado não entram em V nem em S(o)', async () => {
      const c = await cenario();
      await apostar(c, 0, c.melee.id, 300, 'valido');
      await apostar(c, 1, c.melee.id, 200, 'valido');
      await apostar(c, 2, c.ranged.id, 400, 'valido');
      await apostar(c, 3, c.ranged.id, 1000, 'aguardando_deposito');
      await apostar(c, 4, c.melee.id, 1000, 'recusado');
      await apostar(c, 5, c.ranged.id, 1000, 'rascunho');
      await apostar(c, 6, c.melee.id, 1000, 'expirado');

      const resposta = await odds.daRodada(c.rodada.id, c.contas[0]!.userId);

      // V = 900 (só os válidos), P = floor(9·900/10) = 810.
      expect(opcoesDe(resposta, c.topDps.id)).toEqual({
        [c.melee.id]: 810 / 500,
        [c.ranged.id]: 810 / 400,
      });
    });

    it('sem nenhuma aposta válida, toda opção é "—"', async () => {
      const c = await cenario();
      await apostar(c, 0, c.melee.id, 300, 'aguardando_deposito');
      const resposta = await odds.daRodada(c.rodada.id, c.contas[0]!.userId);
      expect(opcoesDe(resposta, c.topDps.id)).toEqual({
        [c.melee.id]: null,
        [c.ranged.id]: null,
      });
    });
  });

  describe('T-Z08 — bettor da rodada vê odds de todos os mercados publicados (D-36)', () => {
    it('um multiplicador por candidato do mercado, em cada mercado de escolha simples', async () => {
      const c = await cenario();
      await apostar(c, 0, c.melee.id, 300, 'valido');

      // Quem vê não precisa ter apostado.
      const resposta = await odds.daRodada(c.rodada.id, c.contas[6]!.userId);

      expect(resposta.roundId).toBe(c.rodada.id);
      expect(opcoesDe(resposta, c.topDps.id)).toEqual({
        [c.melee.id]: 0.9,
        [c.ranged.id]: null,
      });
      // First Death aceita qualquer role (D-04): as três opções, nenhuma com aposta.
      expect(opcoesDe(resposta, c.firstDeath.id)).toEqual({
        [c.melee.id]: null,
        [c.ranged.id]: null,
        [c.heal.id]: null,
      });
    });

    // Mudança de produto (D-54): substitui "a Weekly Progression não aparece —
    // OQ-55". Cada boss de progressão tem a sua odd, como os candidatos.
    it('T-W18: a Weekly tem um multiplicador por boss de progressão', async () => {
      const c = await cenario();
      await apostarEm(
        c,
        0,
        { marketId: c.weekly.id, stake: 600, encounterId: c.prog1.id },
        'valido',
      );
      await apostarEm(
        c,
        1,
        { marketId: c.weekly.id, stake: 400, encounterId: c.prog2.id },
        'valido',
      );
      await apostarEm(
        c,
        2,
        { marketId: c.weekly.id, stake: 900, encounterId: c.prog2.id },
        'rascunho',
      );

      const resposta = await odds.daRodada(c.rodada.id, c.contas[3]!.userId);
      // V 1.000 → P 900: 900/600 e 900/400. O rascunho não conta (D-12).
      expect(opcoesDe(resposta, c.weekly.id)).toEqual({
        [c.prog1.id]: 1.5,
        [c.prog2.id]: 2.25,
      });
    });

    it('conta fora do snapshot de bettors não vê: ContaNaoElegivel', async () => {
      const c = await cenario();
      const fora = await db.user.create({
        data: { battlenetId: randomUUID(), battletag: 'Fora#1', membership: 'member' },
      });
      await expect(odds.daRodada(c.rodada.id, fora.id)).rejects.toBeInstanceOf(ContaNaoElegivel);
    });
  });

  describe('T-Z06 — odds não expõem apostas (§16.10)', () => {
    it('a resposta passa no contrato estrito e não contém conta, slip nem stake', async () => {
      const c = await cenario();
      await apostar(c, 0, c.melee.id, 300, 'valido');
      await apostar(c, 1, c.ranged.id, 700, 'valido');

      const resposta = await odds.daRodada(c.rodada.id, c.contas[2]!.userId);
      expect(oddsDaRodadaSchema.parse(resposta)).toEqual(resposta);

      const json = JSON.stringify(resposta);
      const slips = await db.betSlip.findMany({ where: { roundId: c.rodada.id } });
      for (const s of slips) {
        expect(json).not.toContain(s.id);
        expect(json).not.toContain(s.ownerUserId);
        expect(json).not.toContain(s.ownerBattletag);
      }
      expect(json).not.toMatch(/stake|userId|slip/i);
    });
  });
});
