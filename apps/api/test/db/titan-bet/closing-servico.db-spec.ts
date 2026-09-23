import { randomUUID } from 'node:crypto';
import type { BetCandidateRole, BetMarketKind } from '@prisma/client';
import { closingReportSchema } from '@titan/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ClosingRecusado, ClosingService } from '../../../src/titan-bet/closing.service';
import { ClosingRepository } from '../../../src/titan-bet/closing.repository';
import { DepositoService } from '../../../src/titan-bet/deposito.service';
import { LedgerService, SettlementService } from '../../../src/titan-bet/settlement.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { esperarPassar } from './ciclo';
import { Fabrica } from './fabrica';

/**
 * Round Closing Report (D-21, D-48; §8.5, §16.7): T-C01, T-C04, T-C05.
 * titan-bet-test-design.md §3.10, §3.17.
 *
 * A rodada é liquidada pelos serviços reais (depósito, confirmação, ajuste);
 * o relatório é gerado do resultado confirmado e do ledger.
 */
jest.setTimeout(60_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — Closing Report (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let deposito: DepositoService;
  let settlement: SettlementService;
  let ledger: LedgerService;
  let closing: ClosingService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
    deposito = new DepositoService(repo);
    settlement = new SettlementService(repo);
    ledger = new LedgerService(repo);
    closing = new ClosingService(new ClosingRepository(db));
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  type Pessoa = { characterId: string; role: BetCandidateRole; name: string };

  /**
   * Boss "Boss do Closing" com Top DPS e First Death; candidatos A e B; dois
   * apostadores com personagens de elegibilidade de nome próprio.
   */
  async function cenario() {
    const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 5_000) });
    const boss = await f.encounter(rodada.id, { encounterName: 'Boss do Closing' });
    const topDps = await f.mercadoDeBoss(boss, 'top_dps');
    const firstDeath = await f.mercadoDeBoss(boss, 'first_death');

    const candidato = async (role: BetCandidateRole): Promise<Pessoa> => {
      const pj = await f.personagem();
      const name = `Cand${randomUUID().slice(0, 6)}`;
      await db.betRoundCandidate.create({
        data: { roundId: rodada.id, characterId: pj.id, role, name, realm: 'Azralon' },
      });
      return { characterId: pj.id, role, name };
    };
    const A = await candidato('Melee');
    const B = await candidato('Ranged');

    const apostador = async (name: string) => {
      const pj = await f.personagem();
      await db.betRoundBettor.create({
        data: { roundId: rodada.id, characterId: pj.id, rank: 5, name, realm: 'Goldrinn' },
      });
      return { characterId: pj.id, name, conta: `conta-${randomUUID()}` };
    };
    const ana = await apostador(`Ana${randomUUID().slice(0, 6)}`);
    const bia = await apostador(`Bia${randomUUID().slice(0, 6)}`);
    await f.pronta(rodada.id);

    /** O slip da pessoa, com as apostas, até `valido` pelo serviço de depósito. */
    async function slip(
      quem: { characterId: string; conta: string },
      apostas: Array<[string, BetMarketKind, number, Pessoa]>,
    ) {
      const s = await f.slip(rodada.id, quem.characterId, 'rascunho', {
        ownerUserId: quem.conta,
        ownerBattletag: `Segredo#${randomUUID().slice(0, 4)}`,
      });
      for (const [marketId, kind, stake, alvo] of apostas) {
        await db.bet.create({
          data: {
            slipId: s.id,
            roundId: rodada.id,
            marketId,
            marketKind: kind,
            stake,
            targetCharacterId: alvo.characterId,
            targetRole: alvo.role,
          },
        });
      }
      const total = apostas.reduce((t, a) => t + a[2], 0);
      await db.betSlip.update({
        where: { id: s.id },
        data: {
          status: 'aguardando_deposito',
          submittedAt: new Date(),
          expectedTotal: total,
          depositCharacterId: quem.characterId,
        },
      });
      await deposito.confirmar(s.id, OFFICER);
      return s;
    }

    return { rodada, topDps, firstDeath, A, B, ana, bia, slip };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Cutoff, resultados gravados na auditoria pronta, calculada, confirmada. */
  async function liquidar(
    c: Cenario,
    desfechos: Record<
      string,
      { vencedores: Pessoa[] } | { voidReason: string } | { semVencedor: string }
    >,
  ) {
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
      const validas = await db.bet.findMany({ where: { marketId, slip: { status: 'valido' } } });
      const V = validas.reduce((s, b) => s + b.stake, 0);
      const ids = 'vencedores' in d ? d.vencedores.map((p) => p.characterId) : [];
      const W = validas
        .filter((b) => b.targetCharacterId && ids.includes(b.targetCharacterId))
        .reduce((s, b) => s + b.stake, 0);
      const anulado = 'voidReason' in d;
      const semVencedor = 'semVencedor' in d;
      const r = await db.betMarketResult.create({
        data: {
          auditId: a.id,
          marketId,
          roundId: c.rodada.id,
          outcome: anulado ? 'anulado' : semVencedor ? 'sem_vencedor' : 'vencedores',
          voidReason: anulado ? d.voidReason : null,
          validPool: V,
          prizePool: anulado ? null : Math.floor((9 * V) / 10),
          winningStake: anulado ? null : W,
          evidence: semVencedor ? { versao: 1, motivo: d.semVencedor } : { versao: 1 },
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
    await settlement.confirmar(a.id, OFFICER);
    return a;
  }

  describe('T-C01 — conteúdo certo e sem dado privado (D-21, §16.7)', () => {
    it('mercados, vencedores, ganho por mercado, VOID, Guild Bank e totais; no schema estrito', async () => {
      const c = await cenario();
      const sAna = await c.slip(c.ana, [
        [c.topDps.id, 'top_dps', 700, c.A],
        [c.firstDeath.id, 'first_death', 450, c.B],
      ]);
      const sBia = await c.slip(c.bia, [[c.topDps.id, 'top_dps', 300, c.B]]);
      await liquidar(c, {
        [c.topDps.id]: { vencedores: [c.A] },
        [c.firstDeath.id]: { voidReason: 'mercado_cancelado' },
      });

      const { version } = await closing.publicar(c.rodada.id, OFFICER);
      expect(version).toBe(1);
      const doc = await db.roundClosingReport.findFirstOrThrow({
        where: { roundId: c.rodada.id },
      });
      const conteudo = closingReportSchema.parse(doc.content);

      const top = conteudo.mercados.find((m) => m.marketId === c.topDps.id)!;
      expect(top).toMatchObject({
        kind: 'top_dps',
        encounterName: 'Boss do Closing',
        desfecho: 'vencedores',
        vencedores: [{ name: c.A.name, realm: 'Azralon' }],
        // V 1.000 → P 900, só a aposta da Ana em A venceu.
        ganhos: [{ membro: { name: c.ana.name, realm: 'Goldrinn' }, valor: 900 }],
      });
      const fd = conteudo.mercados.find((m) => m.marketId === c.firstDeath.id)!;
      // Contrato (D-61): `voidReason` virou `motivo`, que vale também para sem vencedor.
      expect(fd).toMatchObject({ desfecho: 'anulado', motivo: 'mercado_cancelado', ganhos: [] });
      expect(conteudo.guildBank).toEqual({ receita: 100, residuo: 0 });

      // Nada de stake, slip, BattleTag ou depósito — nem os valores.
      const json = JSON.stringify(doc.content);
      for (const proibido of [sAna.id, sBia.id, sAna.ownerBattletag, sBia.ownerBattletag]) {
        expect(json).not.toContain(proibido);
      }
      expect(json).not.toMatch(/stake|slip|battletag|deposit|expectedTotal/i);
      // Aposta perdedora da Bia não aparece em lugar nenhum.
      expect(json).not.toContain(c.bia.name);
    });

    it('marca d’água: o último lançamento do ledger lido', async () => {
      const c = await cenario();
      await c.slip(c.ana, [[c.topDps.id, 'top_dps', 500, c.A]]);
      await liquidar(c, { [c.topDps.id]: { vencedores: [c.A] } });
      await closing.publicar(c.rodada.id, OFFICER);

      const doc = await db.roundClosingReport.findFirstOrThrow({ where: { roundId: c.rodada.id } });
      const ultimo = await db.goldLedgerEntry.findFirstOrThrow({
        where: { roundId: c.rodada.id },
        orderBy: { id: 'desc' },
      });
      expect(doc.ledgerThroughEntryId).toBe(ultimo.id);
      expect(doc).toMatchObject({
        publishedByUserId: OFFICER.userId,
        publishedByBattletag: OFFICER.battletag,
      });
    });
  });

  describe('T-M17 no closing — sem vencedor aparece com o motivo (D-61)', () => {
    it('desfecho `sem_vencedor`, motivo, e ninguém identificado', async () => {
      const c = await cenario();
      await c.slip(c.ana, [
        [c.topDps.id, 'top_dps', 500, c.A],
        [c.firstDeath.id, 'first_death', 300, c.A],
      ]);
      await liquidar(c, {
        [c.topDps.id]: { vencedores: [c.A] },
        [c.firstDeath.id]: { semVencedor: 'sem_kill' },
      });
      await closing.publicar(c.rodada.id, OFFICER);

      const doc = closingReportSchema.parse(
        (await db.roundClosingReport.findFirstOrThrow({ where: { roundId: c.rodada.id } })).content,
      );
      expect(doc.mercados.find((m) => m.marketId === c.firstDeath.id)).toMatchObject({
        desfecho: 'sem_vencedor',
        motivo: 'sem_kill',
        vencedores: [],
        ganhos: [],
      });
    });
  });

  describe('T-C04 — o membro é o personagem de elegibilidade, nunca o BattleTag (D-48)', () => {
    it('ganho e total com nome e realm do snapshot de bettors', async () => {
      const c = await cenario();
      const s = await c.slip(c.ana, [[c.topDps.id, 'top_dps', 500, c.A]]);
      await liquidar(c, { [c.topDps.id]: { vencedores: [c.A] } });
      await closing.publicar(c.rodada.id, OFFICER);

      const doc = closingReportSchema.parse(
        (await db.roundClosingReport.findFirstOrThrow({ where: { roundId: c.rodada.id } })).content,
      );
      expect(doc.totais).toEqual([
        { membro: { name: c.ana.name, realm: 'Goldrinn' }, devido: 450 },
      ]);
      expect(JSON.stringify(doc)).not.toContain(s.ownerBattletag);
    });
  });

  describe('T-C05 — total devido agregado por membro (D-48, §8.5)', () => {
    it('prêmio + restituição de VOID + ajuste da conta, num total por personagem', async () => {
      const c = await cenario();
      const s = await c.slip(c.ana, [
        [c.topDps.id, 'top_dps', 500, c.A],
        [c.firstDeath.id, 'first_death', 200, c.A],
      ]);
      await liquidar(c, {
        [c.topDps.id]: { vencedores: [c.A] },
        [c.firstDeath.id]: { voidReason: 'mercado_cancelado' },
      });
      const premio = await db.goldLedgerEntry.findFirstOrThrow({
        where: { slipId: s.id, kind: 'premio' },
      });
      await ledger.ajustar(
        { slipId: s.id, amount: 30, reason: 'correção', correctsEntryId: premio.id },
        OFFICER,
      );
      await closing.publicar(c.rodada.id, OFFICER);

      const doc = closingReportSchema.parse(
        (await db.roundClosingReport.findFirstOrThrow({ where: { roundId: c.rodada.id } })).content,
      );
      // 450 de prêmio + 200 de restituição + 30 de ajuste.
      expect(doc.totais).toEqual([
        { membro: { name: c.ana.name, realm: 'Goldrinn' }, devido: 680 },
      ]);
    });
  });

  describe('publicar — quando vale', () => {
    it('antes da auditoria confirmada → recusado, nada publicado', async () => {
      const c = await cenario();
      await expect(closing.publicar(c.rodada.id, OFFICER)).rejects.toBeInstanceOf(ClosingRecusado);
      expect(await db.roundClosingReport.count({ where: { roundId: c.rodada.id } })).toBe(0);
    });

    it('republicar gera a versão 2; a 1 fica como estava (T-C02 pelo serviço)', async () => {
      const c = await cenario();
      await c.slip(c.ana, [[c.topDps.id, 'top_dps', 500, c.A]]);
      await liquidar(c, { [c.topDps.id]: { vencedores: [c.A] } });
      await closing.publicar(c.rodada.id, OFFICER);
      const v1 = await db.roundClosingReport.findFirstOrThrow({ where: { roundId: c.rodada.id } });

      expect((await closing.publicar(c.rodada.id, OFFICER)).version).toBe(2);
      expect(await db.roundClosingReport.findUniqueOrThrow({ where: { id: v1.id } })).toEqual(v1);
      expect((await closing.ultimo(c.rodada.id))?.version).toBe(2);
    });
  });
});
