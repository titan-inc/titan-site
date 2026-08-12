'use client';

import { useMontado } from './usar-montado';

/** Fuso da guilda: o que o servidor renderiza, antes de saber o de quem lê. */
const FUSO_DA_GUILDA = 'America/Sao_Paulo';

function formatar(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // O nome do fuso vai junto SEMPRE. "21h" sem fuso é ambíguo exatamente
    // entre as pessoas que precisam se combinar — a guilda é US, com realm
    // brasileiro e gente morando fora.
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/**
 * Um instante em UTC, exibido no fuso de quem lê.
 *
 * A primeira renderização usa o fuso da guilda dos dois lados (servidor e
 * cliente), senão a hidratação diverge. Depois dela, troca para o fuso local.
 * Como o nome do fuso aparece no texto, nenhuma das duas versões é ambígua.
 */
export function Quando({ iso }: { iso: string }) {
  const montado = useMontado();

  return <time dateTime={iso}>{formatar(iso, montado ? undefined : FUSO_DA_GUILDA)}</time>;
}
