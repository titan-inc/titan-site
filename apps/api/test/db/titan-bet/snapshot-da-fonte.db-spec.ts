import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { congelarReport } from '../../../src/titan-bet/snapshot';
import { escrita } from './escrita';
import { Fabrica } from './fabrica';

/**
 * D-76 — o snapshot do report congelado no Auditar, protegido no banco:
 * obrigatório em referência nova, amarrado à referência (versão, code,
 * revision) e imutável. titan-bet-test-design.md §43.
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };

describe('Titan Bet — snapshot da fonte (banco)', () => {
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

  const snapshot = (code = 'Terca1', revision = 3) =>
    congelarReport(
      {
        code,
        startTime: 1_000_000,
        revision,
        fights: [{ id: 1, encounterID: 501, difficulty: 5, kill: true, startTime: 0, endTime: 1 }],
        actors: [],
        deaths: [],
        kills: {},
      },
      'titanbet',
      [501],
    ) as unknown as Prisma.InputJsonValue;

  /** Uma fonte automática, com a auditoria em revisão — ainda editável. */
  async function fonte() {
    const rodada = await f.rodada({
      cutoffAt: new Date('2026-09-22T15:00:00Z'),
      readyAt: new Date('2026-09-22T14:00:00Z'),
      readyByUserId: OFFICER.userId,
      readyByBattletag: OFFICER.battletag,
    });
    const a = await db.betAudit.create({
      data: {
        roundId: rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
      },
    });
    return db.betAuditSource.create({
      data: { auditId: a.id, session: 'terca', resolution: 'automatica' },
    });
  }

  const referencia = (
    sourceId: string,
    extra: Partial<Prisma.BetAuditSourceReportUncheckedCreateInput> = {},
  ) =>
    db.betAuditSourceReport.create({
      data: {
        sourceId,
        reportCode: 'Terca1',
        reportTitle: 'titanbet',
        reportRevision: 3,
        reportStartTime: new Date(1_000_000),
        snapshot: snapshot(),
        ...extra,
      },
    });

  it('controle: referência com o snapshot dela → aceita', async () => {
    const s = await fonte();
    expect(await escrita(referencia(s.id))).toBe('aceito');
  });

  it('referência nova sem snapshot → recusada', async () => {
    const s = await fonte();
    expect(await escrita(referencia(s.id, { snapshot: undefined }))).toBe('check');
  });

  it('proveniência: snapshot de outra revisão, de outro report ou de outra versão → recusado', async () => {
    const s = await fonte();
    expect(await escrita(referencia(s.id, { snapshot: snapshot('Terca1', 4) }))).toBe('check');
    expect(await escrita(referencia(s.id, { snapshot: snapshot('Outro', 3) }))).toBe('check');
    const v2 = { ...(snapshot() as Record<string, unknown>), versao: 2 };
    expect(await escrita(referencia(s.id, { snapshot: v2 }))).toBe('check');
  });

  it('imutável: mudar o snapshot depois do Auditar → recusado, mesmo com a auditoria aberta', async () => {
    const s = await fonte();
    const r = await referencia(s.id);
    const b = { ...(snapshot() as Record<string, unknown>), fights: [] };
    expect(
      await escrita(db.betAuditSourceReport.update({ where: { id: r.id }, data: { snapshot: b } })),
    ).toBe('trigger');
    // Nem apagar o snapshot, nem trocar a revisão da referência por baixo dele.
    expect(
      await escrita(
        db.$executeRaw`UPDATE "BetAuditSourceReport" SET "snapshot" = NULL WHERE "id" = ${r.id}`,
      ),
    ).toBe('trigger');
    expect(
      await escrita(
        db.betAuditSourceReport.update({ where: { id: r.id }, data: { reportRevision: 4 } }),
      ),
    ).toBe('trigger');
  });

  it('o histórico não é reavaliado: a obrigatoriedade vale só para referência nova (NOT VALID)', async () => {
    const [c] = await db.$queryRaw<Array<{ convalidated: boolean }>>`
      SELECT convalidated FROM pg_constraint
      WHERE conname = 'BetAuditSourceReport_snapshot_obrigatorio'`;
    expect(c).toEqual({ convalidated: false });
  });
});
