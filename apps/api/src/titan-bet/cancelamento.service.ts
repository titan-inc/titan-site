import { Inject, Injectable, Optional } from '@nestjs/common';
import { faseDaRodada, podeCancelar } from './fases';
import { RELOGIO, relogioDoSistema, type Relogio } from './relogio';
import { TitanBetRepository } from './titan-bet.repository';

/** O cancelamento foi recusado; nada mudou. */
export class CancelamentoRecusado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'CancelamentoRecusado';
  }
}

interface Officer {
  userId: string;
  battletag: string;
}

/**
 * Cancelamento administrativo de rodada (D-77; spec, revisão 16).
 *
 * Um officer cancela, com motivo: a rodada vira CANCELLED — terminal — e todo
 * slip ativo vira `cancelado`, na mesma transação. Nada é apagado e nada entra
 * no ledger: devolver gold depositado é dos officers, fora do Titan Bet. Não se
 * cancela depois do settlement confirmado; o banco confere o mesmo.
 */
@Injectable()
export class CancelamentoService {
  constructor(
    private readonly repo: TitanBetRepository,
    @Optional() @Inject(RELOGIO) private readonly agora: Relogio = relogioDoSistema,
  ) {}

  async cancelar(roundId: string, officer: Officer, motivo: string): Promise<void> {
    const texto = motivo.trim();
    if (!texto) throw new CancelamentoRecusado('o cancelamento exige motivo (D-77)');

    const agora = this.agora();
    let r: Awaited<ReturnType<TitanBetRepository['cancelarRodada']>>;
    try {
      r = await this.repo.cancelarRodada({
        roundId,
        officer,
        motivo: texto,
        agora,
        podeCancelar: (estado) => podeCancelar(estado, agora),
      });
    } catch (erro: unknown) {
      const causa = erro instanceof Error ? erro.message : String(erro);
      throw new CancelamentoRecusado(`o cancelamento não foi gravado: ${causa}`);
    }

    if (r.tipo === 'inexistente') throw new CancelamentoRecusado(`a rodada ${roundId} não existe`);
    if (r.tipo === 'recusado') {
      const fase = faseDaRodada(r.estado, agora);
      throw new CancelamentoRecusado(
        fase === 'CANCELLED'
          ? 'a rodada já foi cancelada'
          : 'a rodada já tem settlement confirmado — não se cancela depois de liquidada (D-77)',
      );
    }
  }
}
