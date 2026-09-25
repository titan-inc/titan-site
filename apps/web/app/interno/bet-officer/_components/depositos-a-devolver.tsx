import type { SlipsSubmetidos } from '@titan/shared';
import { gold, personagem } from '../../bet/_components/rotulos';

/**
 * Rodada cancelada (D-77): os slips que tinham o depósito confirmado — o gold
 * que os officers devolvem **fora do Titan Bet**. Só leitura: nada aqui vira
 * lançamento no ledger nem estado de pagamento.
 */
export function DepositosADevolver({ slips }: { slips: SlipsSubmetidos['slips'] }) {
  const confirmados = slips.filter((s) => s.status === 'cancelado' && s.depositoConfirmado);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-fg-muted text-sm">
        Depósitos confirmados antes do cancelamento. A devolução é feita pelos officers, fora do
        Titan Bet — nada aqui gera lançamento.
      </p>
      {confirmados.length === 0 ? (
        <p className="text-fg-muted text-sm">Nenhum depósito confirmado nesta rodada.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {confirmados.map((s) => (
            <li key={s.slipId} className="text-fg text-sm">
              {s.ownerBattletag} · {s.depositCharacter ? personagem(s.depositCharacter) : '—'} ·{' '}
              {s.expectedTotal !== null ? gold(s.expectedTotal) : '—'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
