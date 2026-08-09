import type { AttendanceState } from '@titan/shared';

/**
 * Rótulo e cor de cada estado.
 *
 * Cores escolhidas com uma regra: **só o estado ambíguo chama atenção.** Falta
 * não é vermelho, porque o sistema não sabe se foi falta — "Não Raidou" quer
 * dizer literalmente "não apareceu em pull nenhuma", e pintar isso de vermelho
 * transformaria a tela num ranking de culpa, que é justamente o que a Regra 7
 * diz para não fazer.
 */
const ESTADOS: Record<AttendanceState, { rotulo: string; classe: string; ajuda: string }> = {
  presente: {
    rotulo: 'Presente',
    classe: 'text-accent',
    ajuda: 'Confirmou e raidou',
  },
  'sem-confirmar': {
    rotulo: 'Sem confirmar',
    classe: 'text-fg',
    ajuda: 'Raidou sem ter confirmado no signup',
  },
  raidou: {
    rotulo: 'Raidou',
    classe: 'text-accent',
    ajuda: 'Esteve na raid. Esta noite não tem lista de signup para comparar',
  },
  'nao-raidou': {
    rotulo: 'Não raidou',
    // `bronze` e não `danger`: vermelho leria como culpa, e o sistema não sabe
    // se foi falta. Chama atenção sem acusar.
    classe: 'text-bronze',
    ajuda: 'Confirmou e não apareceu em pull nenhuma. Só o raid leader sabe o motivo',
  },
  banco: {
    rotulo: 'Banco',
    classe: 'text-fg-muted',
    ajuda: 'Marcou Standby no próprio signup',
  },
  ausente: {
    rotulo: 'Ausente',
    classe: 'text-fg-muted',
    ajuda: 'Declinou no signup',
  },
  rotacao: {
    rotulo: 'Rotação',
    classe: 'text-fg-subtle',
    ajuda: 'Não confirmou e não raidou — não prometeu nada',
  },
  'sem-dado': {
    rotulo: 'Sem dado',
    classe: 'text-fg-subtle',
    ajuda: 'A noite não tem log com pull de boss. Não dá para afirmar nada',
  },
};

export function Estado({ state }: { state: AttendanceState }) {
  const e = ESTADOS[state];

  return (
    <span className={e.classe} title={e.ajuda}>
      {e.rotulo}
    </span>
  );
}

export function rotuloDoEstado(state: AttendanceState): string {
  return ESTADOS[state].rotulo;
}
