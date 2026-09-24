import { AuditoriaRecusada } from './auditoria.service';
import { CalculoService } from './calculo.service';
import type { TitanBetRepository } from './titan-bet.repository';

/**
 * D-76 — tentativa anterior à revisão 15, ainda não calculada: a referência não
 * tem snapshot. O banco não deixa mais gravar referência assim (CHECK
 * `BetAuditSourceReport_snapshot_obrigatorio`, NOT VALID), por isso o caso é
 * montado com o repositório dublado. O Calcular recusa e pede um novo Auditar;
 * nenhum snapshot é fabricado, e o WCL não é consultado — o serviço nem o tem.
 */
describe('CalculoService — tentativa sem snapshot (D-76)', () => {
  it('recusa, identificando o report, sem gravar nada', async () => {
    const gravarCalculo = jest.fn();
    const repo = {
      auditoriaParaCalcular: jest.fn().mockResolvedValue({
        id: 'a-antiga',
        status: 'pronta',
        attempt: 1,
        roundId: 'r1',
        round: {
          cutoffAt: new Date('2026-09-01T15:00:00Z'),
          readyAt: new Date('2026-08-30T15:00:00Z'),
          encounters: [],
          markets: [],
          candidates: [],
        },
        sources: [
          {
            session: 'terca',
            resolution: 'automatica',
            reports: [
              {
                reportCode: 'Antigo1',
                reportTitle: 'titanbet',
                reportRevision: 3,
                reportStartTime: new Date('2026-09-01T23:00:00Z'),
                snapshot: null,
              },
            ],
          },
        ],
      }),
      gravarCalculo,
    } as unknown as TitanBetRepository;

    const r = new CalculoService(repo, () => new Date('2026-09-10T00:00:00Z')).calcular('a-antiga');
    await expect(r).rejects.toBeInstanceOf(AuditoriaRecusada);
    await expect(r).rejects.toThrow(/Antigo1.*audite de novo/);
    expect(gravarCalculo).not.toHaveBeenCalled();
  });
});
