import { randomUUID } from 'node:crypto';
import type { BetRound } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { Ciclo, esperarPassar } from './ciclo';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * D-77 — o cancelamento administrativo no banco (T-X03, T-X04, T-X05;
 * titan-bet-test-design.md §44): a rodada cancelada é terminal, só os slips
 * ativos viram `cancelado`, e nenhuma escrita direta passa depois — sem
 * depender do serviço.
 */
jest.setTimeout(60_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — cancelamento no banco (D-77)', () => {
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

  const CANCELAMENTO = () => ({
    cancelledAt: new Date(),
    cancelledByUserId: OFFICER.userId,
    cancelledByBattletag: OFFICER.battletag,
    cancellationReason: 'raid cancelada',
  });

  const cancelar = (rodada: { id: string }, extra: Partial<BetRound> = {}) =>
    db.betRound.update({ where: { id: rodada.id }, data: { ...CANCELAMENTO(), ...extra } });

  const status = async (id: string) =>
    (await db.betSlip.findUniqueOrThrow({ where: { id } })).status;
  const paraCancelado = (id: string) =>
    db.betSlip.update({ where: { id }, data: { status: 'cancelado' } });

  async function auditoria(
    roundId: string,
    status: 'pronta' | 'calculada' = 'pronta',
    attempt = 1,
  ) {
    return db.betAudit.create({
      data: {
        roundId,
        attempt,
        status,
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
        ...(status === 'calculada' ? { calculatedAt: new Date() } : {}),
      },
    });
  }

  describe('T-X03 — a rodada cancelada', () => {
    it.each(['\t', '\n', '\r\n\t', '\u00a0'])(
      'recusa motivo apenas whitespace %j',
      async (motivo) => {
        const r = await ciclo.preparacao();
        expect(await escrita(cancelar(r, { cancellationReason: motivo }))).toBe('check');
      },
    );

    it('não apaga rodada cancelada mesmo sem dependentes', async () => {
      const r = await ciclo.preparacao();
      await cancelar(r);
      expect(await escrita(db.betRound.delete({ where: { id: r.id } }))).toBe('trigger');
    });

    it.each(['bettor', 'candidato'] as const)(
      'não insere snapshot %s após cancelar em preparação',
      async (tipo) => {
        const r = await ciclo.preparacao();
        const pj = await f.personagem();
        await cancelar(r);
        const inserir = () =>
          tipo === 'bettor' ? f.bettor(r.id, pj.id) : f.candidato(r.id, pj.id, 'Tank');
        expect(await escrita(inserir())).toBe('trigger');
      },
    );

    it('não apaga auditoria histórica sem fontes', async () => {
      const r = await ciclo.preparacao();
      const a = await auditoria(r.id);
      await cancelar(r);
      expect(await escrita(db.betAudit.delete({ where: { id: a.id } }))).toBe('trigger');
    });

    it('não transfere fonte de uma rodada cancelada para outra', async () => {
      const r = await ciclo.preparacao();
      const outra = await ciclo.preparacao();
      const a = await auditoria(r.id);
      const b = await auditoria(outra.id);
      const fonte = await db.betAuditSource.create({
        data: { auditId: a.id, session: 'quinta', resolution: 'ausente' },
      });
      await cancelar(r);
      expect(
        await escrita(
          db.betAuditSource.update({
            where: { id: fonte.id },
            data: { auditId: b.id },
          }),
        ),
      ).toBe('trigger');
    });

    it('controle: cancelar com os quatro campos → aceito', async () => {
      const r = await ciclo.aberta();
      expect(await escrita(cancelar(r.rodada))).toBe('aceito');
    });

    it('sem quem, sem quando ou sem motivo — ou com motivo vazio → recusado', async () => {
      for (const falta of [
        { cancelledAt: null },
        { cancelledByUserId: null },
        { cancelledByBattletag: null },
        { cancellationReason: null },
        { cancellationReason: '   ' },
      ]) {
        const r = await ciclo.aberta();
        expect(await escrita(cancelar(r.rodada, falta))).toBe('check');
      }
    });

    it('terminal: não se desfaz nem se reescreve, e nada mais muda na rodada', async () => {
      const r = await ciclo.aberta();
      await cancelar(r.rodada);
      const naRodada = (data: Partial<BetRound>) =>
        escrita(db.betRound.update({ where: { id: r.rodada.id }, data }));
      expect(
        await naRodada({
          cancelledAt: null,
          cancelledByUserId: null,
          cancelledByBattletag: null,
          cancellationReason: null,
        }),
      ).toBe('trigger');
      expect(await naRodada({ cancellationReason: 'outro motivo' })).toBe('trigger');
      expect(await naRodada({ candidateSourceFetchedAt: new Date() })).toBe('trigger');
    });

    it('não se cancela rodada com auditoria confirmada (settlement)', async () => {
      const r = await ciclo.aberta(3_000);
      await esperarPassar(db, r.rodada.cutoffAt);
      const a = await auditoria(r.rodada.id);
      await db.betAudit.update({
        where: { id: a.id },
        data: {
          status: 'confirmada',
          confirmedAt: new Date(),
          confirmedByUserId: OFFICER.userId,
          confirmedByBattletag: OFFICER.battletag,
        },
      });
      expect(await escrita(cancelar(r.rodada))).toBe('trigger');
    });

    it('rodada em preparação cancelada não recebe Ready', async () => {
      const rodada = await ciclo.preparacao();
      await cancelar(rodada);
      expect(
        await escrita(
          db.betRound.update({
            where: { id: rodada.id },
            data: { readyAt: new Date(), readyByUserId: 'o', readyByBattletag: 'O#1' },
          }),
        ),
      ).toBe('trigger');
    });
  });

  describe('T-X16 — o period depois do cancelamento (D-78)', () => {
    const period = () => 700_000_000 + Math.floor(Math.random() * 100_000_000);
    const rodadaNoPeriod = (p: number) =>
      f.rodada({ period: p, cutoffAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });

    it('duas rodadas ativas no mesmo period → recusado', async () => {
      const p = period();
      await rodadaNoPeriod(p);
      expect(await escrita(rodadaNoPeriod(p))).toBe('unique');
    });

    it('com a do period cancelada, outra rodada no mesmo period → aceita', async () => {
      const p = period();
      const primeira = await rodadaNoPeriod(p);
      await cancelar(primeira);
      expect(await escrita(rodadaNoPeriod(p))).toBe('aceito');
    });

    it('cancelada + ativa no period: a segunda ativa continua recusada', async () => {
      const p = period();
      await cancelar(await rodadaNoPeriod(p));
      await rodadaNoPeriod(p);
      expect(await escrita(rodadaNoPeriod(p))).toBe('unique');
    });
  });

  describe('T-X04 — os slips', () => {
    it('não nasce cancelado em rodada ativa', async () => {
      const r = await ciclo.aberta();
      expect(await escrita(f.slip(r.rodada.id, r.dono.id, 'cancelado'))).toBe('trigger');
    });

    it('não apaga slip cancelado vazio', async () => {
      const r = await ciclo.aberta();
      const s = await f.slip(r.rodada.id, r.dono.id);
      await cancelar(r.rodada);
      await paraCancelado(s.id);
      expect(await escrita(db.betSlip.delete({ where: { id: s.id } }))).toBe('trigger');
    });

    it('cancelar slip não permite fabricar evidência de depósito confirmado', async () => {
      const r = await ciclo.aberta();
      const s = await f.slip(r.rodada.id, r.dono.id);
      await cancelar(r.rodada);
      expect(
        await escrita(
          db.betSlip.update({
            where: { id: s.id },
            data: {
              status: 'cancelado',
              validatedAt: new Date(),
              validatedByUserId: OFFICER.userId,
              validatedByBattletag: OFFICER.battletag,
            },
          }),
        ),
      ).toBe('trigger');
    });

    async function comSlips(cutoffEmMs?: number) {
      const r = await ciclo.aberta(cutoffEmMs);
      const [rascunho, pendente, valido, recusado] = await Promise.all(
        ['a', 'b', 'c', 'd'].map((dono) =>
          f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: `${dono}-${randomUUID()}` }),
        ),
      );
      await ciclo.submeter(pendente!);
      await ciclo.submeter(valido!);
      await ciclo.confirmar(valido!.id);
      await ciclo.submeter(recusado!);
      await ciclo.recusar(recusado!.id);
      return { r, rascunho: rascunho!, pendente: pendente!, valido: valido!, recusado: recusado! };
    }

    it('slip ativo não vira cancelado sem a rodada cancelada', async () => {
      const s = await comSlips();
      for (const slip of [s.rascunho, s.pendente, s.valido]) {
        expect(await escrita(paraCancelado(slip.id))).toBe('trigger');
      }
    });

    it('com a rodada cancelada, os três ativos viram cancelado — mesmo depois do cutoff', async () => {
      const s = await comSlips(3_000);
      await esperarPassar(db, s.r.rodada.cutoffAt);
      await cancelar(s.r.rodada);
      for (const slip of [s.rascunho, s.pendente, s.valido]) {
        expect(await escrita(paraCancelado(slip.id))).toBe('aceito');
      }
      // O que o depósito gravou continua: é por ele que se sabe que estava válido.
      const v = await db.betSlip.findUniqueOrThrow({ where: { id: s.valido.id } });
      expect(v).toMatchObject({ status: 'cancelado', validatedByBattletag: 'Officer#0001' });
      expect(v.submittedAt).toBeInstanceOf(Date);
    });

    it('recusado e expirado não viram cancelado — o histórico não se reescreve', async () => {
      const s = await comSlips(3_000);
      await esperarPassar(db, s.r.rodada.cutoffAt);
      await ciclo.expirar(s.rascunho.id);
      await cancelar(s.r.rodada);
      expect(await escrita(paraCancelado(s.recusado.id))).toBe('trigger');
      expect(await escrita(paraCancelado(s.rascunho.id))).toBe('trigger');
      expect(await status(s.recusado.id)).toBe('recusado');
      expect(await status(s.rascunho.id)).toBe('expirado');
    });

    it('cancelado é terminal', async () => {
      const s = await comSlips();
      await cancelar(s.r.rodada);
      await paraCancelado(s.pendente.id);
      for (const para of [
        'rascunho',
        'aguardando_deposito',
        'valido',
        'recusado',
        'expirado',
      ] as const) {
        expect(
          await escrita(
            db.betSlip.update({ where: { id: s.pendente.id }, data: { status: para } }),
          ),
        ).toBe('trigger');
      }
    });

    it('nada de slip novo, nem transição normal, na rodada cancelada', async () => {
      const s = await comSlips();
      await cancelar(s.r.rodada);
      expect(
        await escrita(f.slip(s.r.rodada.id, s.r.dono.id, 'rascunho', { ownerUserId: 'nova' })),
      ).toBe('trigger');
      // O pendente não pode mais ser confirmado nem recusado.
      expect(await escrita(ciclo.confirmar(s.pendente.id))).toBe('trigger');
      expect(await escrita(ciclo.recusar(s.pendente.id))).toBe('trigger');
    });
  });

  describe('T-X05 — nenhuma escrita direta na rodada cancelada', () => {
    it('resultado já inserido não ganha vencedores ou kills após cancelar', async () => {
      const r = await ciclo.aberta();
      const a = await auditoria(r.rodada.id);
      const resultado = await db.betMarketResult.create({
        data: {
          auditId: a.id,
          marketId: r.topDispels.id,
          roundId: r.rodada.id,
          outcome: 'vencedores',
          validPool: 500,
          prizePool: 450,
          winningStake: 500,
          evidence: {},
          algorithmVersion: 'titanbet-2',
        },
      });
      await cancelar(r.rodada);
      expect(
        await escrita(
          db.betMarketResultWinner.create({
            data: {
              resultId: resultado.id,
              roundId: r.rodada.id,
              characterId: r.candidatos.Tank,
            },
          }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betMarketResultKill.create({
            data: {
              resultId: resultado.id,
              roundId: r.rodada.id,
              roundEncounterId: r.prog.id,
            },
          }),
        ),
      ).toBe('trigger');
    });

    it('escrita SQL concorrente espera o cancelamento e é recusada', async () => {
      const rodada = await ciclo.preparacao();
      let travou!: () => void;
      let liberar!: () => void;
      const travada = new Promise<void>((resolve) => (travou = resolve));
      const liberada = new Promise<void>((resolve) => (liberar = resolve));
      const cancelando = db.$transaction(
        async (tx) => {
          await tx.betRound.update({ where: { id: rodada.id }, data: CANCELAMENTO() });
          travou();
          await liberada;
        },
        { timeout: 10_000 },
      );
      await travada;
      let terminou = false;
      const inserindo = escrita(f.encounter(rodada.id)).then((r) => {
        terminou = true;
        return r;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(terminou).toBe(false);
      } finally {
        liberar();
        await cancelando;
      }
      expect(await inserindo).toBe('trigger');
      expect(await db.betRoundEncounter.count({ where: { roundId: rodada.id } })).toBe(0);
    });

    it('auditoria, fonte, resultado e o avanço da tentativa', async () => {
      const r = await ciclo.aberta(3_000);
      await esperarPassar(db, r.rodada.cutoffAt);
      const a = await auditoria(r.rodada.id, 'pronta');
      const fonte = await db.betAuditSource.create({
        data: { auditId: a.id, session: 'quinta', resolution: 'ausente' },
      });
      await cancelar(r.rodada);

      expect(await escrita(auditoria(r.rodada.id, 'pronta', 2))).toBe('trigger');
      expect(
        await escrita(
          db.betAudit.update({
            where: { id: a.id },
            data: { status: 'calculada', calculatedAt: new Date() },
          }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betAuditSource.update({
            where: { id: fonte.id },
            data: {
              resolution: 'sem_raid',
              noRaidReason: 'x',
              resolvedByUserId: 'o',
              resolvedByBattletag: 'O#1',
              resolvedAt: new Date(),
            },
          }),
        ),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betMarketResult.create({
            data: {
              auditId: a.id,
              marketId: r.topDispels.id,
              roundId: r.rodada.id,
              outcome: 'sem_vencedor',
              validPool: 0,
              prizePool: 0,
              winningStake: 0,
              evidence: { versao: 2 },
              algorithmVersion: 'titanbet-2',
            },
          }),
        ),
      ).toBe('trigger');
    });

    it('ledger: nenhum lançamento, de nenhum tipo', async () => {
      const r = await ciclo.aberta();
      const slip = await f.slip(r.rodada.id, r.dono.id, 'rascunho', { ownerUserId: 'x' });
      await ciclo.submeter(slip);
      await ciclo.confirmar(slip.id);
      await cancelar(r.rodada);
      await paraCancelado(slip.id);
      const lancar = (kind: 'deposito_validado' | 'ajuste' | 'pagamento' | 'premio') =>
        db.goldLedgerEntry.create({
          data: {
            roundId: r.rodada.id,
            account: 'membro',
            slipId: slip.id,
            kind,
            amount: 500,
            actorUserId: OFFICER.userId,
            actorBattletag: OFFICER.battletag,
            reason: 'x',
          },
        });
      for (const kind of ['deposito_validado', 'ajuste', 'pagamento', 'premio'] as const) {
        expect(await escrita(lancar(kind))).toBe('trigger');
      }
      expect(
        await escrita(
          db.goldLedgerEntry.create({
            data: {
              roundId: r.rodada.id,
              account: 'guild_bank',
              kind: 'receita_guilda',
              amount: 50,
              resultId: randomUUID(),
            },
          }),
        ),
      ).toBe('trigger');
    });

    it('Closing Report', async () => {
      const r = await ciclo.aberta(3_000);
      await esperarPassar(db, r.rodada.cutoffAt);
      const a = await auditoria(r.rodada.id, 'calculada');
      await cancelar(r.rodada);
      expect(
        await escrita(
          db.roundClosingReport.create({
            data: {
              roundId: r.rodada.id,
              version: 1,
              auditId: a.id,
              ledgerThroughEntryId: 1n,
              content: { versao: 1 },
              publishedByUserId: OFFICER.userId,
              publishedByBattletag: OFFICER.battletag,
            },
          }),
        ),
      ).toBe('trigger');
    });

    it('configuração da preparação', async () => {
      const rodada = await ciclo.preparacao();
      const enc = await f.encounter(rodada.id);
      const mercado = await f.mercadoDeBoss(enc, 'top_dps');
      await cancelar(rodada);
      expect(await escrita(f.encounter(rodada.id))).toBe('trigger');
      expect(await escrita(db.betMarket.delete({ where: { id: mercado.id } }))).toBe('trigger');
    });

    it('leituras e a trilha continuam: nada é apagado, e BetEvent aceita registro', async () => {
      const r = await ciclo.aberta();
      await cancelar(r.rodada);
      expect(
        await escrita(
          db.betEvent.create({
            data: {
              roundId: r.rodada.id,
              type: 'slip_visualizado',
              actorUserId: OFFICER.userId,
              actorBattletag: OFFICER.battletag,
              payload: {},
            },
          }),
        ),
      ).toBe('aceito');
      expect(await db.betRound.findUnique({ where: { id: r.rodada.id } })).not.toBeNull();
    });
  });
});
