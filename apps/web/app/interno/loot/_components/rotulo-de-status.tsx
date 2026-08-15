import { LOOT_SESSION_STATUS, type LootSessionStatus } from '@titan/shared';

/**
 * O estado da sessão em uma palavra.
 *
 * O rótulo diz o que a pessoa pode fazer agora, e não o nome interno do estado:
 * `aberta` é quando se responde, `deliberando` é quando o conselho decide. Quem
 * lê a tela no meio de uma raid não deveria precisar traduzir.
 */
const ROTULOS: Record<LootSessionStatus, { texto: string; classe: string }> = {
  [LOOT_SESSION_STATUS.RASCUNHO]: {
    texto: 'Rascunho',
    classe: 'border-border text-fg-muted',
  },
  [LOOT_SESSION_STATUS.ABERTA]: {
    texto: 'Respondendo',
    classe: 'border-emerald-500/40 text-emerald-400',
  },
  [LOOT_SESSION_STATUS.DELIBERANDO]: {
    texto: 'Em deliberação',
    classe: 'border-amber-500/40 text-amber-400',
  },
  [LOOT_SESSION_STATUS.ENCERRADA]: {
    texto: 'Encerrada',
    classe: 'border-border text-fg-subtle',
  },
};

export function RotuloDeStatus({ status }: { status: LootSessionStatus }) {
  const { texto, classe } = ROTULOS[status];

  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${classe}`}>
      {texto}
    </span>
  );
}
