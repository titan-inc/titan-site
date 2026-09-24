import type { BetAuditStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * Auditar no banco (§16.4): T-A07, T-A08, T-A11, e as fontes da revisão 11 —
 * vários `titanbet*` por sessão (T-A16) e "sem raid" declarado (T-A19).
 * titan-bet-test-design.md §3.7.
 *
 * Os dados seguem o ciclo de vida: a fonte é gravada com a auditoria aberta, e
 * só depois a auditoria vira `confirmada` — é a ordem que o service usa.
 */
describe('Titan Bet — auditoria e fontes (banco)', () => {
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
  const CONFIRMOU = {
    confirmedByUserId: 'officer-teste',
    confirmedByBattletag: 'Officer#0001',
    confirmedAt: new Date(),
  };
  const REFERENCIA = {
    reportTitle: 'titanbet',
    reportRevision: 3,
    reportStartTime: new Date('2026-09-30T00:00:00Z'),
  };
  const RESOLVEU = {
    resolvedByUserId: 'officer-teste',
    resolvedByBattletag: 'Officer#0001',
    resolvedAt: new Date(),
  };

  function auditoria(roundId: string, attempt: number, status: BetAuditStatus = 'pronta') {
    return db.betAudit.create({ data: { roundId, attempt, status, ...OFFICER } });
  }

  function fonte(auditId: string, data: Partial<Prisma.BetAuditSourceUncheckedCreateInput> = {}) {
    return db.betAuditSource.create({
      data: {
        auditId,
        session: 'terca',
        resolution: 'automatica',
        ...data,
      },
    });
  }

  /** Um `titanbet*` usado pela fonte, com a referência congelada (D-63). */
  function relatorio(
    sourceId: string,
    data: Partial<Prisma.BetAuditSourceReportUncheckedCreateInput> = {},
  ) {
    return db.betAuditSourceReport.create({
      data: { sourceId, reportCode: 'AbC123', ...REFERENCIA, ...data },
    });
  }

  /** Auditoria confirmada, gravada na ordem real: fontes, depois a confirmação. */
  async function confirmada(roundId: string, attempt = 1) {
    const a = await auditoria(roundId, attempt);
    const terca = await fonte(a.id);
    const doc = await relatorio(terca.id);
    await fonte(a.id, { session: 'quinta' });
    await db.betAudit.update({ where: { id: a.id }, data: { status: 'confirmada', ...CONFIRMOU } });
    return { auditoria: a, terca, doc };
  }

  describe('T-A07 — uma auditoria confirmada por rodada (§16.4)', () => {
    it('a segunda `confirmada` da mesma rodada é recusada', async () => {
      const rodada = await f.rodada();
      await confirmada(rodada.id, 1);
      const segunda = await auditoria(rodada.id, 2);
      expect(
        await escrita(
          db.betAudit.update({
            where: { id: segunda.id },
            data: { status: 'confirmada', ...CONFIRMOU },
          }),
        ),
      ).toBe('unique');
    });

    it('controle: várias substituídas e uma confirmada convivem; outra rodada tem a sua', async () => {
      const rodada = await f.rodada();
      expect(await escrita(auditoria(rodada.id, 1, 'substituida'))).toBe('aceito');
      expect(await escrita(auditoria(rodada.id, 2, 'substituida'))).toBe('aceito');
      await confirmada(rodada.id, 3);
      const outra = await f.rodada();
      expect(await escrita(confirmada(outra.id, 1))).toBe('aceito');
    });
  });

  describe('T-A11 — sessão só `terca`/`quinta`, no máximo uma de cada (D-37)', () => {
    it('duas `terca` na mesma auditoria → recusado', async () => {
      const rodada = await f.rodada();
      const a = await auditoria(rodada.id, 1);
      await fonte(a.id);
      expect(await escrita(fonte(a.id))).toBe('unique');
    });

    it('sessão fora do enum → recusada (estrutura: o enum já barra)', async () => {
      const rodada = await f.rodada();
      const a = await auditoria(rodada.id, 1);
      const resultado = await escrita(
        db.$executeRaw`INSERT INTO "BetAuditSource" ("id", "auditId", "session", "resolution")
          VALUES (${`s-${a.id}`}, ${a.id}, 'quarta', 'ausente')`,
      );
      expect(resultado).not.toBe('aceito');
      expect(resultado).toMatch(/^outro:22P02/);
    });

    it('controle: terça e quinta na mesma auditoria; terça em outra tentativa', async () => {
      const rodada = await f.rodada();
      const a = await auditoria(rodada.id, 1);
      expect(await escrita(fonte(a.id))).toBe('aceito');
      expect(await escrita(fonte(a.id, { session: 'quinta' }))).toBe('aceito');
      const b = await auditoria(rodada.id, 2);
      expect(await escrita(fonte(b.id))).toBe('aceito');
    });
  });

  // Mudança de produto (D-63): o T-A06 no banco (`escolha_officer`, `ambigua`,
  // referência única na fonte) saiu. A fonte usa todos os `titanbet*` da sessão,
  // cada um numa linha própria (T-A16), e a sessão sem raid é declarada (T-A19).
  describe('T-A16 no banco — os `titanbet*` da sessão, cada um uma vez', () => {
    it('controle: dois reports na mesma fonte automática', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      const t = await fonte(a.id);
      expect(await escrita(relatorio(t.id))).toBe('aceito');
      expect(await escrita(relatorio(t.id, { reportCode: 'XyZ789' }))).toBe('aceito');
    });

    it('o mesmo report duas vezes na mesma fonte → recusado', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      const t = await fonte(a.id);
      await relatorio(t.id);
      expect(await escrita(relatorio(t.id))).toBe('unique');
    });

    it('report em fonte ausente ou sem raid → recusado: não há report usado', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      const ausente = await fonte(a.id, { resolution: 'ausente' });
      expect(await escrita(relatorio(ausente.id))).toBe('trigger');
      const semRaid = await fonte(a.id, {
        session: 'quinta',
        resolution: 'sem_raid',
        noRaidReason: 'raid cancelada',
        ...RESOLVEU,
      });
      expect(await escrita(relatorio(semRaid.id))).toBe('trigger');
    });
  });

  describe('T-A19 no banco — "sem raid oficial" tem motivo e officer (D-60)', () => {
    it('sem raid sem motivo → recusado', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      expect(await escrita(fonte(a.id, { resolution: 'sem_raid', ...RESOLVEU }))).toBe('check');
    });

    it('sem raid sem officer → recusado', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      expect(
        await escrita(fonte(a.id, { resolution: 'sem_raid', noRaidReason: 'raid cancelada' })),
      ).toBe('check');
    });

    it('motivo de "sem raid" em fonte automática ou ausente → recusado', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      expect(await escrita(fonte(a.id, { noRaidReason: 'x' }))).toBe('check');
      expect(
        await escrita(fonte(a.id, { session: 'quinta', resolution: 'ausente', noRaidReason: 'x' })),
      ).toBe('check');
    });

    it('controle: sem raid com motivo e officer; ausente e automática sem motivo', async () => {
      const r = await f.rodada();
      const a = await auditoria(r.id, 1);
      expect(
        await escrita(
          fonte(a.id, { resolution: 'sem_raid', noRaidReason: 'raid cancelada', ...RESOLVEU }),
        ),
      ).toBe('aceito');
      expect(await escrita(fonte(a.id, { session: 'quinta', resolution: 'ausente' }))).toBe(
        'aceito',
      );
    });
  });

  describe('T-A08 — auditoria confirmada é imutável (D-08, §16.4)', () => {
    it('não muda status nem campos da auditoria confirmada', async () => {
      const { auditoria: a } = await confirmada((await f.rodada()).id);
      expect(
        await escrita(db.betAudit.update({ where: { id: a.id }, data: { status: 'pronta' } })),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betAudit.update({ where: { id: a.id }, data: { confirmedByBattletag: 'Outro#1' } }),
        ),
      ).toBe('trigger');
      expect(await escrita(db.betAudit.delete({ where: { id: a.id } }))).toBe('trigger');
    });

    it('não muda nem apaga fonte de auditoria confirmada', async () => {
      const { terca, doc } = await confirmada((await f.rodada()).id);
      expect(
        await escrita(
          db.betAuditSource.update({ where: { id: terca.id }, data: { resolution: 'ausente' } }),
        ),
      ).toBe('trigger');
      // E os reports congelados dela também (D-63).
      expect(
        await escrita(
          db.betAuditSourceReport.update({ where: { id: doc.id }, data: { reportRevision: 4 } }),
        ),
      ).toBe('trigger');
      expect(await escrita(db.betAuditSourceReport.delete({ where: { id: doc.id } }))).toBe(
        'trigger',
      );
      expect(await escrita(db.betAuditSource.delete({ where: { id: terca.id } }))).toBe('trigger');
    });

    it('não acrescenta fonte depois da confirmação', async () => {
      // Confirmada só com a terça, para a quinta não esbarrar no unique de sessão.
      const a = await auditoria((await f.rodada()).id, 1);
      await fonte(a.id);
      await db.betAudit.update({
        where: { id: a.id },
        data: { status: 'confirmada', ...CONFIRMOU },
      });
      expect(await escrita(fonte(a.id, { session: 'quinta' }))).toBe('trigger');
      const terca = await db.betAuditSource.findFirstOrThrow({ where: { auditId: a.id } });
      expect(await escrita(relatorio(terca.id, { reportCode: 'Novo1' }))).toBe('trigger');
    });

    it('tentativa substituída também fica intacta (T-A09 no banco)', async () => {
      const a = await auditoria((await f.rodada()).id, 1);
      const terca = await fonte(a.id);
      await relatorio(terca.id);
      await db.betAudit.update({ where: { id: a.id }, data: { status: 'substituida' } });
      expect(
        await escrita(db.betAudit.update({ where: { id: a.id }, data: { status: 'pronta' } })),
      ).toBe('trigger');
      expect(
        await escrita(
          db.betAuditSource.update({ where: { id: terca.id }, data: { resolution: 'ausente' } }),
        ),
      ).toBe('trigger');
    });

    it('controle: auditoria aberta aceita declarar "sem raid" e mudar de estado', async () => {
      const a = await auditoria((await f.rodada()).id, 1, 'aguardando_revisao');
      const quinta = await fonte(a.id, { session: 'quinta', resolution: 'ausente' });
      expect(
        await escrita(
          db.betAuditSource.update({
            where: { id: quinta.id },
            data: { resolution: 'sem_raid', noRaidReason: 'raid cancelada', ...RESOLVEU },
          }),
        ),
      ).toBe('aceito');
      expect(
        await escrita(db.betAudit.update({ where: { id: a.id }, data: { status: 'pronta' } })),
      ).toBe('aceito');
    });
  });
});
