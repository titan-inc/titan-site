import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { Ciclo, type RodadaAberta } from './ciclo';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * RED-M2C — GoldLedgerEntry, a única fonte financeira (§16.6, D-37, D-39).
 * Ver docs/specs/titan-bet-test-design.md §3.6 e §7.
 *
 * O caso de TRUNCATE fica por último no arquivo: sem o trigger, ele de fato
 * esvazia a tabela no titan_test.
 */
describe('Titan Bet — ledger (banco)', () => {
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

  const OFFICER = { actorUserId: 'officer-teste', actorBattletag: 'Officer#0001' };

  async function cenario() {
    const r = await ciclo.aberta();
    const { slip, aposta } = await ciclo.slipComAposta(r);
    return { r, slip, aposta };
  }

  /** Lançamento válido na conta do membro; o teste sobrescreve o que viola. */
  function doMembro(
    r: RodadaAberta,
    slipId: string,
    extra: Partial<Prisma.GoldLedgerEntryUncheckedCreateInput> = {},
  ) {
    return db.goldLedgerEntry.create({
      data: {
        roundId: r.rodada.id,
        account: 'membro',
        slipId,
        kind: 'deposito_validado',
        amount: 500,
        ...OFFICER,
        ...extra,
      },
    });
  }

  function daGuilda(
    r: RodadaAberta,
    extra: Partial<Prisma.GoldLedgerEntryUncheckedCreateInput> = {},
  ) {
    return db.goldLedgerEntry.create({
      data: {
        roundId: r.rodada.id,
        account: 'guild_bank',
        kind: 'receita_guilda',
        amount: 50,
        marketId: r.topDispels.id,
        resultId: randomUUID(),
        ...extra,
      },
    });
  }

  describe('T-L02 — forma dos lançamentos (§16.4)', () => {
    it('controle: depósito, receita, ajuste negativo e pagamento válidos são aceitos', async () => {
      const { r, slip, aposta } = await cenario();
      const premio = await doMembro(r, slip.id, {
        kind: 'premio',
        amount: 900,
        betId: aposta.id,
        marketId: r.topDispels.id,
      });
      expect(await escrita(doMembro(r, slip.id))).toBe('aceito');
      expect(await escrita(daGuilda(r))).toBe('aceito');
      expect(
        await escrita(
          doMembro(r, slip.id, {
            kind: 'ajuste',
            amount: -100,
            correctsEntryId: premio.id,
            reason: 'prêmio calculado com parse errado',
          }),
        ),
      ).toBe('aceito');
      expect(
        await escrita(
          doMembro(r, slip.id, { kind: 'pagamento', amount: 800, coversThroughEntryId: premio.id }),
        ),
      ).toBe('aceito');
    });

    it.each([0, -1])('recusa valor %i fora de ajuste', async (amount) => {
      const { r, slip } = await cenario();
      expect(await escrita(doMembro(r, slip.id, { amount }))).toBe('check');
    });

    it('recusa ajuste de valor zero, sem motivo, sem referência ou sem officer', async () => {
      const { r, slip } = await cenario();
      const alvo = await doMembro(r, slip.id);
      const ajuste = { kind: 'ajuste' as const, amount: 50, correctsEntryId: alvo.id, reason: 'x' };

      expect(await escrita(doMembro(r, slip.id, { ...ajuste, amount: 0 }))).toBe('check');
      expect(await escrita(doMembro(r, slip.id, { ...ajuste, reason: null }))).toBe('check');
      expect(await escrita(doMembro(r, slip.id, { ...ajuste, correctsEntryId: null }))).toBe(
        'check',
      );
      expect(await escrita(doMembro(r, slip.id, { ...ajuste, actorUserId: null }))).toBe('check');
    });

    it('recusa conta de membro sem slip, e conta da guilda com slip', async () => {
      const { r, slip } = await cenario();
      expect(await escrita(doMembro(r, slip.id, { slipId: null }))).toBe('check');
      expect(await escrita(daGuilda(r, { slipId: slip.id }))).toBe('check');
    });

    it('recusa pagamento sem officer ou sem o que ele quita', async () => {
      const { r, slip, aposta } = await cenario();
      // Mudança de produto (D-67): o crédito deste caso era uma
      // `restituicao_expirado`, que deixou de ser lançável. Qualquer crédito
      // serve para o que o teste mede — o pagamento sem officer ou sem alvo.
      const credito = await doMembro(r, slip.id, {
        kind: 'premio',
        amount: 900,
        betId: aposta.id,
        marketId: r.topDispels.id,
      });
      const pagamento = { kind: 'pagamento' as const, coversThroughEntryId: credito.id };

      expect(
        await escrita(
          doMembro(r, slip.id, { ...pagamento, actorUserId: null, actorBattletag: null }),
        ),
      ).toBe('check');
      expect(
        await escrita(doMembro(r, slip.id, { ...pagamento, coversThroughEntryId: null })),
      ).toBe('check');
    });
  });

  describe('T-L12 — slip que nunca chegou a válido não tem restituição no ledger (D-67)', () => {
    it('`restituicao_expirado` novo → recusado: devolução física é dos officers, fora do Titan Bet', async () => {
      const { r, slip } = await cenario();
      expect(
        await escrita(doMembro(r, slip.id, { kind: 'restituicao_expirado', reason: 'x' })),
      ).toBe('check');
    });

    it('controle: a restituição de mercado anulado continua lançável', async () => {
      const { r, slip, aposta } = await cenario();
      expect(
        await escrita(
          doMembro(r, slip.id, {
            kind: 'restituicao_anulado',
            amount: 300,
            betId: aposta.id,
            marketId: r.topDispels.id,
          }),
        ),
      ).toBe('aceito');
    });
  });

  describe('T-L03 — idempotência (§16.4)', () => {
    it('recusa dois lançamentos de resultado para a mesma aposta', async () => {
      const { r, slip, aposta } = await cenario();
      const premio = { kind: 'premio' as const, betId: aposta.id, marketId: r.topDispels.id };
      await doMembro(r, slip.id, premio);
      expect(await escrita(doMembro(r, slip.id, premio))).toBe('unique');
      expect(await escrita(doMembro(r, slip.id, { ...premio, kind: 'restituicao_anulado' }))).toBe(
        'unique',
      );
    });

    it('recusa dois depósitos validados do mesmo slip', async () => {
      const { r, slip } = await cenario();
      await doMembro(r, slip.id);
      expect(await escrita(doMembro(r, slip.id))).toBe('unique');
    });

    it('recusa duas receitas e dois resíduos do mesmo resultado', async () => {
      const { r } = await cenario();
      const resultId = randomUUID();
      await daGuilda(r, { resultId });
      await daGuilda(r, { resultId, kind: 'residuo_guilda', amount: 1 });
      expect(await escrita(daGuilda(r, { resultId }))).toBe('unique');
      expect(await escrita(daGuilda(r, { resultId, kind: 'residuo_guilda', amount: 1 }))).toBe(
        'unique',
      );
    });

    it('controle: receita e resíduo do mesmo resultado, e prêmios de apostas diferentes', async () => {
      const { r, slip, aposta } = await cenario();
      const resultId = randomUUID();
      expect(await escrita(daGuilda(r, { resultId }))).toBe('aceito');
      expect(await escrita(daGuilda(r, { resultId, kind: 'residuo_guilda', amount: 1 }))).toBe(
        'aceito',
      );

      const outro = await ciclo.slipComAposta(r, 'outra-conta');
      expect(await escrita(doMembro(r, slip.id, { kind: 'premio', betId: aposta.id }))).toBe(
        'aceito',
      );
      expect(
        await escrita(doMembro(r, outro.slip.id, { kind: 'premio', betId: outro.aposta.id })),
      ).toBe('aceito');
    });
  });

  describe('T-L08 — nenhum valor financeiro fora do ledger (guarda de regressão, sem RED)', () => {
    it('só o GoldLedgerEntry tem coluna de valor de dinheiro', async () => {
      const colunas = await db.$queryRaw<Array<{ tabela: string; nome: string }>>`
        SELECT table_name AS tabela, column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name LIKE 'Bet%' OR table_name = 'GoldLedgerEntry')`;
      // V, P e W do resultado são entrada do cálculo, não valor de ninguém — a
      // exceção que a própria definição do T-L08 faz (§16.6). Nomeadas uma a
      // uma: qualquer outra coluna de dinheiro continua quebrando o guarda.
      const entradasDoCalculo = new Set([
        'BetMarketResult.validPool',
        'BetMarketResult.prizePool',
        'BetMarketResult.winningStake',
      ]);
      const dinheiro = colunas.filter(
        (c) =>
          !entradasDoCalculo.has(`${c.tabela}.${c.nome}`) &&
          /amount|payout|paid|balance|owed|winning|premio|saldo|valor/i.test(c.nome),
      );
      expect(dinheiro).toEqual([{ tabela: 'GoldLedgerEntry', nome: 'amount' }]);
    });
  });

  describe('T-L01 — append-only no Postgres (D-37, D-39)', () => {
    it('recusa UPDATE e DELETE de lançamento', async () => {
      const { r, slip } = await cenario();
      const lancamento = await doMembro(r, slip.id);
      expect(
        await escrita(
          db.goldLedgerEntry.update({ where: { id: lancamento.id }, data: { amount: 1 } }),
        ),
      ).toBe('trigger');
      expect(await escrita(db.goldLedgerEntry.delete({ where: { id: lancamento.id } }))).toBe(
        'trigger',
      );
    });

    it('recusa TRUNCATE', async () => {
      const { r, slip } = await cenario();
      await doMembro(r, slip.id);
      expect(await escrita(db.$executeRawUnsafe('TRUNCATE "GoldLedgerEntry"'))).toBe('trigger');
    });
  });
});
