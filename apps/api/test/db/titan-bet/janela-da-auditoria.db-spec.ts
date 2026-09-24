import { PrismaService } from '../../../src/prisma/prisma.service';
import type { ReportDaGuilda } from '../../../src/titan-bet/auditoria';
import { AuditoriaRecusada, AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { CalculoService } from '../../../src/titan-bet/calculo.service';
import { LedgerRecusado, SettlementService } from '../../../src/titan-bet/settlement.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { Fabrica } from './fabrica';

/**
 * D-73 — a rodada só entra em auditoria depois de quinta 23:30 no fuso da
 * guilda. Antes disso, Auditar, "sem raid", Calcular e Confirmar são recusados
 * pelo backend; nenhum é caminho alternativo. titan-bet-test-design.md §42.3.
 *
 * O relógio é o dos serviços (o instante da decisão), injetado; o banco não
 * ganha relógio especial. Cutoff: terça 22/09/2026 12:00 BRT → a auditoria abre
 * na quinta 24/09 23:30 BRT (25/09 02:30 UTC).
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const CUTOFF = new Date('2026-09-22T15:00:00Z');
const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);
const QUINTA_2329 = brt('2026-09-24', '23:29');
const QUINTA_2330 = brt('2026-09-24', '23:30');

const report = (code: string, startTime: number): ReportDaGuilda => ({
  code,
  title: 'titanbet',
  revision: 1,
  startTime,
});

describe('Titan Bet — janela da auditoria (D-73, serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function rodadaFechada() {
    return f.rodada({
      cutoffAt: CUTOFF,
      readyAt: new Date(CUTOFF.getTime() - 60 * 60 * 1000),
      readyByUserId: OFFICER.userId,
      readyByBattletag: OFFICER.battletag,
    });
  }

  function wcl() {
    return {
      listGuildReports: jest
        .fn<Promise<ReportDaGuilda[]>, [Date, Date]>()
        .mockResolvedValue([
          report('Terca1', brt('2026-09-22', '21:00').getTime()),
          report('Quinta1', brt('2026-09-24', '20:30').getTime()),
        ]),
    };
  }

  const auditoriasDa = (roundId: string) => db.betAudit.count({ where: { roundId } });

  describe('Auditar', () => {
    const recusados: Array<[string, Date]> = [
      ['terça 11:59, antes do cutoff', brt('2026-09-22', '11:59')],
      ['terça depois do cutoff', brt('2026-09-22', '12:01')],
      ['terça à noite, depois da raid', brt('2026-09-22', '23:59')],
      ['quarta', brt('2026-09-23', '15:00')],
      ['quinta 23:29', QUINTA_2329],
    ];

    it.each(recusados)('%s → recusado, sem ler o WCL e sem gravar nada', async (_nome, agora) => {
      const rodada = await rodadaFechada();
      const porta = wcl();
      const servico = new AuditoriaService(repo, porta, () => agora);

      await expect(servico.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(porta.listGuildReports).not.toHaveBeenCalled();
      expect(await auditoriasDa(rodada.id)).toBe(0);
    });

    it('depois do cutoff e antes de quinta 23:30, o motivo diz quando abre', async () => {
      const rodada = await rodadaFechada();
      const servico = new AuditoriaService(repo, wcl(), () => brt('2026-09-23', '15:00'));
      await expect(servico.auditar(rodada.id, OFFICER)).rejects.toThrow(/quinta.*23:30/i);
    });

    it.each([
      ['quinta 23:30', QUINTA_2330],
      ['sexta 01:00', brt('2026-09-25', '01:00')],
    ])('%s → aceito', async (_nome, agora) => {
      const rodada = await rodadaFechada();
      const servico = new AuditoriaService(repo, wcl(), () => agora);
      const { auditId } = await servico.auditar(rodada.id, OFFICER);
      expect(await db.betAudit.findUniqueOrThrow({ where: { id: auditId } })).toMatchObject({
        status: 'pronta',
      });
    });
  });

  /** Auditoria gravada direto no repositório — a porta que o Auditar recusaria. */
  async function auditoriaGravada(quinta: 'automatica' | 'ausente') {
    const rodada = await rodadaFechada();
    const { auditId } = await repo.gravarAuditoria({
      roundId: rodada.id,
      officer: OFFICER,
      status: quinta === 'automatica' ? 'pronta' : 'aguardando_revisao',
      fontes: [
        {
          session: 'terca',
          resolution: 'automatica',
          reports: [report('Terca1', brt('2026-09-22', '21:00').getTime())],
        },
        quinta === 'automatica'
          ? {
              session: 'quinta',
              resolution: 'automatica',
              reports: [report('Quinta1', brt('2026-09-24', '20:30').getTime())],
            }
          : { session: 'quinta', resolution: 'ausente', reports: [] },
      ],
    });
    return { rodada, auditId };
  }

  it('"sem raid" antecipado na quinta não fecha a rodada antes de 23:30', async () => {
    const { auditId } = await auditoriaGravada('ausente');
    const servico = new AuditoriaService(repo, wcl(), () => brt('2026-09-24', '12:00'));

    await expect(
      servico.declararSemRaid(auditId, 'quinta', 'raid cancelada', OFFICER),
    ).rejects.toBeInstanceOf(AuditoriaRecusada);
    const quinta = await db.betAuditSource.findFirstOrThrow({
      where: { auditId, session: 'quinta' },
    });
    expect(quinta.resolution).toBe('ausente');
  });

  it('Calcular chamado direto antes de quinta 23:30 → recusado, sem ler o WCL', async () => {
    const { auditId } = await auditoriaGravada('automatica');
    const leitor = { getTitanBetReport: jest.fn() };
    const servico = new CalculoService(repo, leitor, () => QUINTA_2329);

    await expect(servico.calcular(auditId)).rejects.toBeInstanceOf(AuditoriaRecusada);
    expect(leitor.getTitanBetReport).not.toHaveBeenCalled();
    expect((await db.betAudit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe('pronta');
  });

  it('Confirmar chamado direto antes de quinta 23:30 → recusado, nada no ledger', async () => {
    const { rodada, auditId } = await auditoriaGravada('automatica');
    await repo.gravarCalculo({ auditId, roundId: rodada.id, agora: new Date(), resultados: [] });
    const servico = new SettlementService(repo, () => QUINTA_2329);

    await expect(servico.confirmar(auditId, OFFICER)).rejects.toBeInstanceOf(LedgerRecusado);
    expect((await db.betAudit.findUniqueOrThrow({ where: { id: auditId } })).status).toBe(
      'calculada',
    );
    expect(await db.goldLedgerEntry.count({ where: { roundId: rodada.id } })).toBe(0);
  });
});
