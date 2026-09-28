import { STAKE_MAXIMO, STAKE_MINIMO } from '@titan/shared';
import type { ResumoDoRascunho } from './total-do-rascunho';
import { gold } from './rotulos';

const numero = (n: number) => n.toLocaleString('pt-BR');

/**
 * A barra que acompanha a rolagem com o total do rascunho (D-79). É informação, não
 * ação: quem grava continua sendo o Salvar. `role="status"` para o leitor de tela
 * anunciar a soma nova sem tirar o foco do campo.
 */
export function TotalFlutuante({
  resumo,
  alterado,
}: {
  resumo: ResumoDoRascunho;
  alterado: boolean;
}) {
  const { total, mercadosEscolhidos, mercadosTotal, stakesInvalidos } = resumo;

  return (
    <div
      role="status"
      className="border-border bg-surface sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border px-4 py-3 shadow-lg"
    >
      <span className="text-fg-muted text-sm">
        Total apostado: <strong className="text-fg font-mono">{gold(total)}</strong>
      </span>
      <span className="text-fg-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>{`${mercadosEscolhidos} de ${mercadosTotal} mercados`}</span>
        {alterado && <span className="text-bronze">não salvo</span>}
        {stakesInvalidos > 0 && (
          <span className="text-red-400">
            {`${stakesInvalidos} ${stakesInvalidos === 1 ? 'stake fora' : 'stakes fora'} de ${numero(STAKE_MINIMO)}–${numero(STAKE_MAXIMO)}`}
          </span>
        )}
      </span>
    </div>
  );
}
