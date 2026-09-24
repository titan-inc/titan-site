import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * T-C02 — o Round Closing Report é imutável; republicar gera versão nova
 * (§16.7). titan-bet-test-design.md §3.10. Banco só: o conteúdo depende da
 * OQ-51 e é do service.
 *
 * O TRUNCATE fica por último: sem o trigger, ele esvazia a tabela no titan_test.
 */
describe('Titan Bet — Round Closing Report (banco)', () => {
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

  async function rodadaConfirmada() {
    const rodada = await f.rodada();
    await f.pronta(rodada.id);
    const auditoria = await db.betAudit.create({
      data: {
        roundId: rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: 'officer-teste',
        startedByBattletag: 'Officer#0001',
      },
    });
    await db.betAudit.update({
      where: { id: auditoria.id },
      data: {
        status: 'confirmada',
        confirmedAt: new Date(),
        confirmedByUserId: 'officer-teste',
        confirmedByBattletag: 'Officer#0001',
      },
    });
    return { rodada, auditoria };
  }

  function publicar(
    r: { rodada: { id: string }; auditoria: { id: string } },
    data: Partial<Prisma.RoundClosingReportUncheckedCreateInput> = {},
  ) {
    return db.roundClosingReport.create({
      data: {
        roundId: r.rodada.id,
        version: 1,
        auditId: r.auditoria.id,
        ledgerThroughEntryId: 1n,
        content: { versao: 1 },
        publishedByUserId: 'officer-teste',
        publishedByBattletag: 'Officer#0001',
        ...data,
      },
    });
  }

  it('controle: versão 1 e versão 2 da mesma rodada', async () => {
    const r = await rodadaConfirmada();
    expect(await escrita(publicar(r))).toBe('aceito');
    expect(await escrita(publicar(r, { version: 2 }))).toBe('aceito');
  });

  it('a mesma versão duas vezes → recusado', async () => {
    const r = await rodadaConfirmada();
    await publicar(r);
    expect(await escrita(publicar(r))).toBe('unique');
  });

  it('auditoria de outra rodada → recusado', async () => {
    const r = await rodadaConfirmada();
    const outra = await rodadaConfirmada();
    expect(await escrita(publicar({ rodada: r.rodada, auditoria: outra.auditoria }))).toBe('fk');
  });

  it('UPDATE e DELETE de um relatório publicado → recusados', async () => {
    const r = await rodadaConfirmada();
    const doc = await publicar(r);
    expect(
      await escrita(
        db.roundClosingReport.update({ where: { id: doc.id }, data: { content: { versao: 9 } } }),
      ),
    ).toBe('trigger');
    expect(await escrita(db.roundClosingReport.delete({ where: { id: doc.id } }))).toBe('trigger');
  });

  it('TRUNCATE → recusado', async () => {
    const r = await rodadaConfirmada();
    await publicar(r);
    expect(await escrita(db.$executeRawUnsafe('TRUNCATE "RoundClosingReport"'))).toBe('trigger');
  });
});
