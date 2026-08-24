'use client';

import { useSyncExternalStore } from 'react';

/** Nunca muda: o valor vira `true` uma vez, quando o cliente assume. */
const semInscricao = () => () => {};

/**
 * Falso no servidor e durante a hidratação; verdadeiro depois dela.
 *
 * Existe para o que só o navegador sabe — no caso, o **fuso de quem lê**. O
 * servidor não tem como saber, então a primeira renderização precisa ser igual
 * dos dois lados, ou a hidratação diverge.
 *
 * `useSyncExternalStore` e não `useEffect` + `setState`: o efeito faria uma
 * renderização em cascata, que é o que a regra `react-hooks/set-state-in-effect`
 * barra.
 */
export function useMontado(): boolean {
  return useSyncExternalStore(
    semInscricao,
    () => true,
    () => false,
  );
}
