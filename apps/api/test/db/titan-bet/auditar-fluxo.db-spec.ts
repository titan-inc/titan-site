import { auditoriaCorrenteSchema } from '@titan/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import type { ReportDaGuilda } from '../../../src/titan-bet/auditoria';
import { AuditoriaRecusada, AuditoriaService } from '../../../src/titan-bet/auditoria.service';
import { TitanBetRepository } from '../../../src/titan-bet/titan-bet.repository';
import { Fabrica } from './fabrica';

/**
 * Auditar — o fluxo (D-24, D-25, D-30; spec §7.2): T-A04, T-A05, T-A06, T-A09,
 * T-A12. titan-bet-test-design.md §3.7.
 *
 * O WCL é falso — a fonte é o que está sob teste, não a rede. Os horários são
 * de uma semana real: cutoff na terça 22/09/2026, 12:00 BRT (15:00 UTC).
 */
jest.setTimeout(30_000);

const OFFICER = { userId: 'officer-teste', battletag: 'Officer#0001' };
const OUTRO_OFFICER = { userId: 'officer-dois', battletag: 'Officer#0002' };
const CUTOFF = new Date('2026-09-22T15:00:00Z');

const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`).getTime();
const TERCA = brt('2026-09-22', '21:00');
const QUINTA = brt('2026-09-24', '20:30');

const report = (code: string, startTime: number, over: Partial<ReportDaGuilda> = {}) => ({
  code,
  title: 'titanbet',
  revision: 7,
  startTime,
  ...over,
});

describe('Titan Bet — Auditar (serviço + banco)', () => {
  let db: PrismaService;
  let f: Fabrica;
  let repo: TitanBetRepository;
  let wcl: { listGuildReports: jest.Mock<Promise<ReportDaGuilda[]>, [Date, Date]> };
  let auditoria: AuditoriaService;

  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    f = new Fabrica(db);
    repo = new TitanBetRepository(db);
  });

  beforeEach(() => {
    wcl = { listGuildReports: jest.fn<Promise<ReportDaGuilda[]>, [Date, Date]>() };
    auditoria = new AuditoriaService(repo, wcl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Rodada que teve Ready e já passou do cutoff — onde o Auditar acontece. */
  function rodadaFechada() {
    return f.rodada({
      cutoffAt: CUTOFF,
      readyAt: new Date(CUTOFF.getTime() - 60 * 60 * 1000),
      readyByUserId: OFFICER.userId,
      readyByBattletag: OFFICER.battletag,
    });
  }

  const fontesDe = (auditId: string) =>
    db.betAuditSource.findMany({ where: { auditId }, orderBy: { session: 'asc' } });

  describe('T-A04 — caminho feliz: um `titanbet*` por sessão, sem seleção manual (D-30)', () => {
    it('duas fontes automáticas, auditoria pronta, officer e horário registrados', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('Terca1', TERCA, { title: 'TitanBet Tuesday' }),
        report('Comum1', TERCA, { title: 'Titan Inc Mythic' }),
        report('Quarta1', brt('2026-09-23', '21:00')),
        report('Quinta1', QUINTA, { revision: 12 }),
      ]);

      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a).toMatchObject({
        roundId: rodada.id,
        attempt: 1,
        status: 'pronta',
        startedByUserId: OFFICER.userId,
        startedByBattletag: OFFICER.battletag,
      });
      const [terca, quinta] = await fontesDe(auditId);
      expect(terca).toMatchObject({
        session: 'terca',
        resolution: 'automatica',
        reportCode: 'Terca1',
        reportTitle: 'TitanBet Tuesday',
        reportRevision: 7,
        reportStartTime: new Date(TERCA),
        resolvedByUserId: null,
      });
      expect(quinta).toMatchObject({
        session: 'quinta',
        resolution: 'automatica',
        reportCode: 'Quinta1',
        reportRevision: 12,
      });
    });

    it('a janela pedida ao WCL começa no cutoff e cobre a quinta inteira', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([]);
      await auditoria.auditar(rodada.id, OFFICER);

      const [de, ate] = wcl.listGuildReports.mock.calls[0]!;
      expect(de.getTime()).toBeLessThanOrEqual(CUTOFF.getTime());
      expect(ate.getTime()).toBeGreaterThanOrEqual(brt('2026-09-24', '23:59'));
    });
  });

  describe('T-A05 — report ausente: para, não calcula, não vira `{}` (D-24)', () => {
    it('sem `titanbet*` na quinta → quinta `ausente`, auditoria aguardando revisão', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('Terca1', TERCA),
        report('Comum1', QUINTA, { title: 'raid de quinta' }),
      ]);

      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('aguardando_revisao');
      expect(a.calculatedAt).toBeNull();
      const [, quinta] = await fontesDe(auditId);
      expect(quinta).toMatchObject({ resolution: 'ausente', reportCode: null, candidates: [] });
    });

    it('WCL fora do ar não vira auditoria nenhuma — lacuna não é resultado (§7.4)', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockRejectedValue(new Error('WCL 503'));
      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(0);
    });
  });

  describe('T-A06 — vários candidatos: o officer escolhe e fica registrado (D-25)', () => {
    async function ambigua() {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('TercaA', TERCA, { title: 'titanbet', revision: 3 }),
        report('TercaB', TERCA + 60_000, { title: 'titanbet 2', revision: 5 }),
        report('Quinta1', QUINTA),
      ]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      return { rodada, auditId };
    }

    it('dois na terça → `ambigua`, com os candidatos como evidência; o sistema não escolhe', async () => {
      const { auditId } = await ambigua();
      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('aguardando_revisao');
      const [terca] = await fontesDe(auditId);
      expect(terca).toMatchObject({ resolution: 'ambigua', reportCode: null });
      expect((terca!.candidates as Array<{ code: string }>).map((c) => c.code).sort()).toEqual([
        'TercaA',
        'TercaB',
      ]);
    });

    it('o officer escolhe: `escolha_officer`, com officer, horário e a referência do candidato', async () => {
      const { auditId } = await ambigua();
      await auditoria.escolherFonte(auditId, 'terca', 'TercaB', OUTRO_OFFICER);

      const [terca] = await fontesDe(auditId);
      expect(terca).toMatchObject({
        resolution: 'escolha_officer',
        reportCode: 'TercaB',
        reportTitle: 'titanbet 2',
        reportRevision: 5,
        resolvedByUserId: OUTRO_OFFICER.userId,
        resolvedByBattletag: OUTRO_OFFICER.battletag,
      });
      expect(terca!.resolvedAt).toBeInstanceOf(Date);
      // Resolvida a única pendência, a auditoria fica pronta.
      const a = await db.betAudit.findUniqueOrThrow({ where: { id: auditId } });
      expect(a.status).toBe('pronta');
    });

    it('o Officer Panel vê a tentativa com os candidatos, no contrato do shared', async () => {
      const { rodada, auditId } = await ambigua();
      const vista = await auditoria.corrente(rodada.id);
      expect(auditoriaCorrenteSchema.parse(vista)).toEqual(vista);
      expect(vista).toMatchObject({ auditId, attempt: 1, status: 'aguardando_revisao' });
      expect(vista?.fontes.map((f) => [f.session, f.resolution, f.candidatos.length])).toEqual([
        ['terca', 'ambigua', 2],
        ['quinta', 'automatica', 1],
      ]);
    });

    it('report fora dos candidatos → recusado, nada muda', async () => {
      const { auditId } = await ambigua();
      await expect(
        auditoria.escolherFonte(auditId, 'terca', 'Comum1', OFFICER),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
      const [terca] = await fontesDe(auditId);
      expect(terca?.resolution).toBe('ambigua');
    });

    it('sessão que não está ambígua não se escolhe — nem a automática, nem a ausente', async () => {
      const { auditId } = await ambigua();
      await expect(
        auditoria.escolherFonte(auditId, 'quinta', 'Quinta1', OFFICER),
      ).rejects.toBeInstanceOf(AuditoriaRecusada);
    });
  });

  describe('T-A09 — refazer a auditoria cria outra tentativa (D-30)', () => {
    it('a anterior fica `substituida`, apontando a nova, com as fontes intactas', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA)]);
      const primeira = await auditoria.auditar(rodada.id, OFFICER);
      const fontesAntes = await fontesDe(primeira.auditId);

      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      const segunda = await auditoria.auditar(rodada.id, OUTRO_OFFICER);

      const [a1, a2] = await db.betAudit.findMany({
        where: { roundId: rodada.id },
        orderBy: { attempt: 'asc' },
      });
      expect(a1).toMatchObject({ status: 'substituida', supersededByAuditId: segunda.auditId });
      expect(a2).toMatchObject({ id: segunda.auditId, attempt: 2, status: 'pronta' });
      expect(await fontesDe(primeira.auditId)).toEqual(fontesAntes);
    });

    it('rodada com auditoria confirmada não se audita de novo', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([report('Terca1', TERCA), report('Quinta1', QUINTA)]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);
      await db.betAudit.update({
        where: { id: auditId },
        data: {
          status: 'confirmada',
          confirmedAt: new Date(),
          confirmedByUserId: OFFICER.userId,
          confirmedByBattletag: OFFICER.battletag,
        },
      });

      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(await db.betAudit.count({ where: { roundId: rodada.id } })).toBe(1);
    });
  });

  describe('T-A12 — as referências usadas ficam congeladas (D-30, §15.10)', () => {
    it('a escolha do officer usa o candidato gravado, não uma leitura nova do WCL', async () => {
      const rodada = await rodadaFechada();
      wcl.listGuildReports.mockResolvedValue([
        report('TercaA', TERCA, { revision: 3 }),
        report('TercaB', TERCA + 60_000, { revision: 5 }),
      ]);
      const { auditId } = await auditoria.auditar(rodada.id, OFFICER);

      // O report recebeu upload depois do Auditar: o WCL agora responde outra revisão.
      wcl.listGuildReports.mockResolvedValue([report('TercaB', TERCA + 60_000, { revision: 99 })]);
      await auditoria.escolherFonte(auditId, 'terca', 'TercaB', OFFICER);

      const [terca] = await fontesDe(auditId);
      expect(terca?.reportRevision).toBe(5);
      expect(wcl.listGuildReports).toHaveBeenCalledTimes(1);
    });
  });

  describe('quando o Auditar vale (§16.2, §16.5)', () => {
    it('antes do cutoff → recusado: apostas ainda abertas', async () => {
      const rodada = await f.rodada({ cutoffAt: new Date(Date.now() + 60 * 60 * 1000) });
      await f.pronta(rodada.id);
      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
      expect(wcl.listGuildReports).not.toHaveBeenCalled();
    });

    it('rodada que nunca teve Ready → recusado: não houve aposta', async () => {
      const rodada = await f.rodada({ cutoffAt: CUTOFF });
      await expect(auditoria.auditar(rodada.id, OFFICER)).rejects.toBeInstanceOf(AuditoriaRecusada);
    });

    it('rodada inexistente → recusado', async () => {
      await expect(auditoria.auditar('nao-existe', OFFICER)).rejects.toBeInstanceOf(
        AuditoriaRecusada,
      );
    });
  });
});
