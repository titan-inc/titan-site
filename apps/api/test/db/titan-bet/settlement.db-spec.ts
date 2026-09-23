import { randomUUID } from 'node:crypto';
import type { BetCandidateRole, BetMarketKind } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import {
  LedgerRecusado,
  LedgerService,
  SettlementService,
} from '../../../src/titan-bet/settlement.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { esperarPassar } from './ciclo';
import { Fabrica } from './fabrica';

/**
 * Settlement e pagamento no banco (D-06, D-10, D-11, D-12, D-16, D-44; §8,
 * §16.6). titan-bet-test-design.md §3.5, §3.6, §3.14: T-M07, T-M08, T-M13,
 * T-M14 (integrados), T-L05, T-L06, T-L07.
 *
 * Ciclo de vida real: depósitos confirmados pelo serviço (com o lançamento
 * `deposito_validado`), cutoff, auditoria calculada com os resultados gravados
 * enquanto `pronta`, e então a confirmação do officer.
 */
jest.setTimeout(60_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const OUTRO = { userId: 'officer-dois', battletag: 'Officer#0002' };

describe('Titan Bet — settlement e ledger (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let deposito: DepositoService;
  let settlement: SettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
    deposito = new DepositoService(repo);
    settlement = new SettlementService(repo);
    ledger = new LedgerService(repo);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  type Pessoa = { characterId: string; role: BetCandidateRole };

  /** Rodada com Top DPS e First Death no boss farm; candidatos A (Melee) e B (Ranged). */
  async function cenario() {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 5_000) });
    const boss = await f.encounter(rodada.id);
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const firstDeath = await f.mercadoDeBoss(boss, 'first_death');
    const A: Pessoa = { characterId: (await f.personagem()).id, role: 'Melee' };
    const B: Pessoa = { characterId: (await f.personagem()).id, role: 'Ranged' };
    await f.candidato(rodada.id, A.characterId, A.role);
    await f.candidato(rodada.id, B.characterId, B.role);
    const apostador = await f.personagem();
    await f.bettor(rodada.id, apostador.id);
    await f.pronta(rodada.id);

    /** Um slip com uma aposta, levado ao status pedido pelo fluxo real. */
    async function apostar(
      marketId: string,
      kind: BetMarketKind,
      stake: number,
      alvo: Pessoa,
      ate: 'valido' | 'aguardando_deposito' = 'valido',
    ) {
      const slip = await f.slip(rodada.id, apostador.id, 'rascunho', {
        ownerUserId: `conta-${randomUUID()}`,
      });
      const bet = await db.bet.create({
        data: {
          slipId: slip.id,
          roundId: rodada.id,
          marketId,
          marketKind: kind,
          stake,
          targetCharacterId: alvo.characterId,
          targetRole: alvo.role,
        },
      });
      await db.betSlip.update({
        where: { id: slip.id },
        data: {
          status: 'aguardando_deposito',
          submittedAt: new Date(),
          expectedTotal: stake,
          depositCharacterId: apostador.id,
        },
      });
      if (ate === 'valido') await deposito.confirmar(slip.id, OFFICER);
      return { slipId: slip.id, betId: bet.id };
    }

    return { rodada, topDps, firstDeath, A, B, apostar };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;
  type Desfecho =
    { outcome: 'vencedores'; vencedores: Pessoa[] } | { outcome: 'anulado'; voidReason: string };

  /**
   * Depois do cutoff: auditoria com os resultados gravados enquanto `pronta`,
   * e então `calculada` — a ordem do CalculoService. V/P/W como ele grava.
   */
  async function calculada(c: Cenario, desfechos: Record<string, Desfecho>) {
    await esperarPassar(db, c.rodada.cutoffAt);
    const a = await db.betAudit.create({
      data: {
        roundId: c.rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
      },
    });
    for (const [marketId, d] of Object.entries(desfechos)) {
      const validas = await db.bet.findMany({
        where: { marketId, slip: { status: 'valido' } },
      });
      const V = validas.reduce((s, b) => s + b.stake, 0);
      const ids = d.outcome === 'vencedores' ? d.vencedores.map((p) => p.characterId) : [];
      const W = validas
        .filter((b) => b.targetCharacterId && ids.includes(b.targetCharacterId))
        .reduce((s, b) => s + b.stake, 0);
      const r = await db.betMarketResult.create({
        data: {
          auditId: a.id,
          marketId,
          roundId: c.rodada.id,
          outcome: d.outcome,
          voidReason: d.outcome === 'anulado' ? d.voidReason : null,
          validPool: V,
          prizePool: d.outcome === 'anulado' ? null : Math.floor((9 * V) / 10),
          winningStake: d.outcome === 'anulado' ? null : W,
          evidence: { versao: 1 },
          algorithmVersion: 'titanbet-1',
        },
      });
      for (const characterId of ids) {
        await db.betMarketResultWinner.create({
          data: { resultId: r.id, roundId: c.rodada.id, characterId },
        });
      }
    }
    await db.betAudit.update({
      where: { id: a.id },
      data: { status: 'calculada', calculatedAt: new Date() },
    });
    return a;
  }

  const lancamentos = (roundId: string) =>
    db.goldLedgerEntry.findMany({ where: { roundId }, orderBy: { id: 'asc' } });

  describe('T-M08 — nada de prêmio ou restituição antes da confirmação (D-16)', () => {
    it('calculada: só os depósitos; confirmada: prêmios, receita e resíduo', async () => {
      const c = await cenario();
      const a1 = await c.apostar(c.topDps.id, 'top_dps', 700, c.A);
      await c.apostar(c.topDps.id, 'top_dps', 300, c.B);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });

      expect((await lancamentos(c.rodada.id)).map((l) => l.kind)).toEqual([
        'deposito_validado',
        'deposito_validado',
      ]);

      await settlement.confirmar(a.id, OFFICER);

      const auditoria = await db.betAudit.findUniqueOrThrow({ where: { id: a.id } });
      expect(auditoria).toMatchObject({
        status: 'confirmada',
        confirmedByUserId: OFFICER.userId,
        confirmedByBattletag: OFFICER.battletag,
      });
      const ls = (await lancamentos(c.rodada.id)).filter((l) => l.kind !== 'deposito_validado');
      // V 1.000 → P 900; só A venceu (W 700) → prêmio 900; G₀ 100; resíduo 0 não vira linha.
      expect(ls.map((l) => [l.kind, l.account, l.amount, l.betId])).toEqual([
        ['premio', 'membro', 900, a1.betId],
        ['receita_guilda', 'guild_bank', 100, null],
      ]);
      expect(ls.every((l) => l.actorUserId === OFFICER.userId)).toBe(true);
    });

    it('VOID confirmado: restituição integral por aposta, sem receita (D-06)', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 700, c.A);
      const y = await c.apostar(c.topDps.id, 'top_dps', 300, c.B);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'anulado', voidReason: 'sem_kill' },
      });
      await settlement.confirmar(a.id, OFFICER);

      const ls = (await lancamentos(c.rodada.id)).filter((l) => l.kind !== 'deposito_validado');
      expect(ls.map((l) => [l.kind, l.amount, l.betId])).toEqual([
        ['restituicao_anulado', 700, x.betId],
        ['restituicao_anulado', 300, y.betId],
      ]);
    });
  });

  describe('T-M07 — o settlement usa só apostas `valido` (D-12)', () => {
    it('pendente não entra em V nem ganha prêmio', async () => {
      const c = await cenario();
      await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const pendente = await c.apostar(c.topDps.id, 'top_dps', 1000, c.A, 'aguardando_deposito');
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });
      await settlement.confirmar(a.id, OFFICER);

      const ls = await lancamentos(c.rodada.id);
      expect(ls.some((l) => l.betId === pendente.betId)).toBe(false);
      expect(ls.find((l) => l.kind === 'premio')?.amount).toBe(450);
    });
  });

  describe('T-M13 integrado — órfão reparte o P com o premiável (D-44)', () => {
    it('First Death vence B, só há aposta em A: o P vai para o Top DPS', async () => {
      const c = await cenario();
      const top = await c.apostar(c.topDps.id, 'top_dps', 600, c.A);
      await c.apostar(c.firstDeath.id, 'first_death', 1000, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
        [c.firstDeath.id]: { outcome: 'vencedores', vencedores: [c.B] },
      });
      await settlement.confirmar(a.id, OFFICER);

      const ls = (await lancamentos(c.rodada.id)).filter((l) => l.kind !== 'deposito_validado');
      // Top DPS: P 540 + cota 900 = 1.440, W 600 → prêmio 1.440; órfão: G₀ 100.
      expect(ls.find((l) => l.betId === top.betId)).toMatchObject({ kind: 'premio', amount: 1440 });
      expect(
        ls.filter((l) => l.kind === 'receita_guilda').map((l) => [l.marketId, l.amount]),
      ).toEqual(
        expect.arrayContaining([
          [c.topDps.id, 60],
          [c.firstDeath.id, 100],
        ]),
      );
      expect(ls.some((l) => l.kind === 'restituicao_anulado')).toBe(false);
    });
  });

  describe('T-M14 integrado — sem premiável, a confirmação para (D-44)', () => {
    it('só o órfão e um VOID: recusado, nada lançado, auditoria continua calculada', async () => {
      const c = await cenario();
      await c.apostar(c.firstDeath.id, 'first_death', 1000, c.A);
      await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const a = await calculada(c, {
        [c.firstDeath.id]: { outcome: 'vencedores', vencedores: [c.B] },
        [c.topDps.id]: { outcome: 'anulado', voidReason: 'sem_kill' },
      });

      await expect(settlement.confirmar(a.id, OFFICER)).rejects.toThrow(/nenhum mercado premiável/);
      expect((await lancamentos(c.rodada.id)).map((l) => l.kind)).toEqual([
        'deposito_validado',
        'deposito_validado',
      ]);
      expect((await db.betAudit.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
        'calculada',
      );
    });
  });

  describe('confirmação — quando vale', () => {
    it('só auditoria calculada; confirmar duas vezes: a segunda é recusada', async () => {
      const c = await cenario();
      await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });
      const [um, dois] = await Promise.allSettled([
        settlement.confirmar(a.id, OFFICER),
        settlement.confirmar(a.id, OUTRO),
      ]);
      expect([um.status, dois.status].sort()).toEqual(['fulfilled', 'rejected']);
      expect((await lancamentos(c.rodada.id)).filter((l) => l.kind === 'premio')).toHaveLength(1);
    });
  });

  describe('T-L07 — reconciliações da §16.6', () => {
    it('Σ depósitos = Σ prêmios + restituições + receitas + resíduos da rodada', async () => {
      const c = await cenario();
      await c.apostar(c.topDps.id, 'top_dps', 700, c.A);
      await c.apostar(c.topDps.id, 'top_dps', 333, c.B);
      await c.apostar(c.topDps.id, 'top_dps', 211, c.B);
      await c.apostar(c.firstDeath.id, 'first_death', 450, c.B);
      await c.apostar(c.firstDeath.id, 'first_death', 999, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A, c.B] },
        [c.firstDeath.id]: { outcome: 'anulado', voidReason: 'sem_kill' },
      });
      await settlement.confirmar(a.id, OFFICER);

      const ls = await lancamentos(c.rodada.id);
      const soma = (...kinds: string[]) =>
        ls.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount, 0);
      expect(soma('deposito_validado')).toBe(
        soma('premio', 'restituicao_anulado', 'receita_guilda', 'residuo_guilda'),
      );
    });
  });

  describe('T-L05 — pagar = lançar o saldo; concorrente paga zero (§16.6)', () => {
    it('um pagamento do saldo inteiro; o segundo, ao mesmo tempo, é recusado', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });
      await settlement.confirmar(a.id, OFFICER);

      const tentativas = await Promise.allSettled([
        ledger.pagar(x.slipId, OFFICER),
        ledger.pagar(x.slipId, OUTRO),
      ]);
      expect(tentativas.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
      const recusa = tentativas.find((t) => t.status === 'rejected') as PromiseRejectedResult;
      expect(recusa.reason).toBeInstanceOf(LedgerRecusado);

      const pagos = (await lancamentos(c.rodada.id)).filter((l) => l.kind === 'pagamento');
      expect(pagos.map((p) => p.amount)).toEqual([450]);
      expect(pagos[0]!.coversThroughEntryId).not.toBeNull();
      expect(await ledger.saldo(x.slipId)).toBe(0);
    });

    it('sem nada devido → recusado', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      await expect(ledger.pagar(x.slipId, OFFICER)).rejects.toBeInstanceOf(LedgerRecusado);
    });
  });

  describe('T-L06 — pago nunca é reescrito; correção é ajuste + novo pagamento (D-11)', () => {
    it('ajuste +100 depois de pago → saldo 100 → segundo pagamento; o primeiro intacto', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });
      await settlement.confirmar(a.id, OFFICER);
      await ledger.pagar(x.slipId, OFFICER);
      const [primeiro] = (await lancamentos(c.rodada.id)).filter((l) => l.kind === 'pagamento');
      const premio = (await lancamentos(c.rodada.id)).find((l) => l.kind === 'premio')!;

      await ledger.ajustar(
        {
          slipId: x.slipId,
          amount: 100,
          reason: 'kill conferida à mão',
          correctsEntryId: premio.id,
        },
        OUTRO,
      );
      expect(await ledger.saldo(x.slipId)).toBe(100);
      await ledger.pagar(x.slipId, OUTRO);

      const pagos = (await lancamentos(c.rodada.id)).filter((l) => l.kind === 'pagamento');
      expect(pagos.map((p) => p.amount)).toEqual([450, 100]);
      expect(pagos[0]).toEqual(primeiro);
      const ajuste = (await lancamentos(c.rodada.id)).find((l) => l.kind === 'ajuste')!;
      expect(ajuste).toMatchObject({
        amount: 100,
        reason: 'kill conferida à mão',
        correctsEntryId: premio.id,
        actorUserId: OUTRO.userId,
      });
    });

    it('ajuste que deixaria saldo negativo → recusado (OQ-52 em aberto)', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const a = await calculada(c, {
        [c.topDps.id]: { outcome: 'vencedores', vencedores: [c.A] },
      });
      await settlement.confirmar(a.id, OFFICER);
      await ledger.pagar(x.slipId, OFFICER);
      const premio = (await lancamentos(c.rodada.id)).find((l) => l.kind === 'premio')!;

      await expect(
        ledger.ajustar(
          { slipId: x.slipId, amount: -50, reason: 'prêmio a mais', correctsEntryId: premio.id },
          OFFICER,
        ),
      ).rejects.toThrow(/OQ-52/);
      expect((await lancamentos(c.rodada.id)).some((l) => l.kind === 'ajuste')).toBe(false);
    });

    it('ajuste sem motivo ou corrigindo lançamento de outro slip → recusado', async () => {
      const c = await cenario();
      const x = await c.apostar(c.topDps.id, 'top_dps', 500, c.A);
      const y = await c.apostar(c.topDps.id, 'top_dps', 500, c.B);
      const [depX] = await db.goldLedgerEntry.findMany({ where: { slipId: x.slipId } });
      await expect(
        ledger.ajustar(
          { slipId: y.slipId, amount: 10, reason: 'x', correctsEntryId: depX!.id },
          OFFICER,
        ),
      ).rejects.toBeInstanceOf(LedgerRecusado);
      await expect(
        ledger.ajustar(
          { slipId: x.slipId, amount: 10, reason: '  ', correctsEntryId: depX!.id },
          OFFICER,
        ),
      ).rejects.toBeInstanceOf(LedgerRecusado);
    });
  });
});
