import { randomInt } from 'node:crypto';

/**
 * Amostragem para dado de TESTE (ferramenta de dev), não para nada que decida
 * quem leva item — aquilo usa `randomInt` direto no `loot-sessions.service.ts`
 * e tem o próprio comentário sobre por quê. Aqui o `randomInt` é só porque já
 * é a primitiva que o projeto usa; não há bar de auditoria a atender.
 */

/** Um inteiro entre `min` e `max`, os dois INCLUSIVE. */
export function sortearEntre(min: number, max: number): number {
  return randomInt(min, max + 1);
}

/** Um elemento aleatório do array. Lança se vazio — quem chama já garante que não está. */
export function amostraUm<T>(itens: readonly T[]): T {
  if (itens.length === 0) throw new Error('amostraUm() chamado com array vazio');
  const item = itens[randomInt(0, itens.length)];
  if (item === undefined) throw new Error('amostraUm() chamado com array vazio');
  return item;
}

/** Até `n` elementos distintos do array, embaralhados. `n` maior que o array devolve tudo. */
export function amostrarAte<T>(itens: readonly T[], n: number): T[] {
  return embaralhar(itens).slice(0, Math.max(0, n));
}

/** Uma cópia embaralhada (Fisher–Yates). Nunca muta o array original. */
export function embaralhar<T>(itens: readonly T[]): T[] {
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const guardado = copia[i] as T;
    copia[i] = copia[j] as T;
    copia[j] = guardado;
  }
  return copia;
}
