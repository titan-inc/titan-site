import {
  ehEspelhoDeTeste,
  type RaidCatalog,
  type RaidPull,
} from '../warcraftlogs/warcraftlogs.service';

/** Mythic: a dificuldade do time de raid, e a única que o Titan Bet conta. */
const MYTHIC = 5;

/**
 * A zone do conteúdo atual da guilda: a da atividade de raid **real** mais
 * recente (decisão B2, 24/09/2026).
 *
 * Atividade de raid real é pull **Mythic** de boss do catálogo de raid, fora de
 * espelho de PTR/Beta. Isso deixa de fora, pelo dado e não pelo nome:
 *
 * - Dummy Dome — só tem Normal;
 * - Delves — dificuldades próprias (108, 109);
 * - o espelho de Beta de uma raid (a zone 54 da 53) — gêmeo em `id - 50000`;
 * - qualquer zone que só aparece no catálogo, sem a guilda ter pullado.
 *
 * Sem atividade válida, `null`. Nunca maior id, posição, nome ou data do
 * catálogo: isso seria inventar o tier. Consequência aceita — tier novo só vira
 * "atual" na primeira pull real da guilda nele.
 */
export function zonaDaAtividadeMaisRecente(
  pulls: RaidPull[],
  catalogo: RaidCatalog,
): number | null {
  let maisRecente: { zoneId: number; startedAt: number } | null = null;

  for (const p of pulls) {
    if (p.difficulty !== MYTHIC) continue;
    const boss = catalogo.encounters.get(p.encounterId);
    if (!boss || ehEspelhoDeTeste(boss, catalogo.encounters)) continue;
    if (!maisRecente || p.startedAt > maisRecente.startedAt) {
      maisRecente = { zoneId: boss.zoneId, startedAt: p.startedAt };
    }
  }

  return maisRecente?.zoneId ?? null;
}
