import { z } from 'zod';
import { seasonOptionSchema } from './progress.js';

/**
 * Progressão de raid: como cada boss do tier foi, por dificuldade.
 *
 * A fonte é o Warcraft Logs. O relatório é da **guilda**, não de pessoas —
 * nenhum dado individual entra aqui, o que é o motivo de bastar `MemberGuard`
 * em vez do gate de oficial da Regra 7.
 */

/** Dificuldade como o WCL numera: 5 Mítico, 4 Heroico, 3 Normal, 1 LFR. */
export const raidDifficultySchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type RaidDifficulty = z.infer<typeof raidDifficultySchema>;

/** Como um boss foi em UMA dificuldade. */
export const bossDifficultyProgressSchema = z.object({
  difficulty: z.number().int(),

  /** Pulls, incluindo as que mataram. */
  pulls: z.number().int(),

  /** Quantas vezes o boss morreu. Mais de uma é farm. */
  kills: z.number().int(),

  /** ISO da primeira kill. Nulo = ainda não morreu nessa dificuldade. */
  firstKillAt: z.string().nullable(),

  /**
   * Melhor wipe, em **% de vida restante do boss** — menor é melhor.
   *
   * Nulo quando não houve wipe nenhum (matou em todas as pulls). Nulo aqui é
   * "não existe", não "zero": 0% seria um wipe com o boss no chão.
   */
  bestPercent: z.number().nullable(),
});
export type BossDifficultyProgress = z.infer<typeof bossDifficultyProgressSchema>;

export const bossProgressSchema = z.object({
  /** Id do encounter no WCL. Identidade estável do boss. */
  encounterId: z.number().int(),
  name: z.string(),

  /** Só as dificuldades em que o boss teve pull. */
  byDifficulty: bossDifficultyProgressSchema.array(),
});
export type BossProgress = z.infer<typeof bossProgressSchema>;

/**
 * Uma raid, na granularidade que o jogador reconhece.
 *
 * **Não é a zona do WCL.** O WCL junta as raids de um tier numa zona só — nesta
 * season, "VS / DR / MQD" é uma zona com 9 bosses espalhados por três raids de
 * verdade. Quem separa é o `gameZone` de cada pull.
 */
export const raidProgressSchema = z.object({
  /**
   * Id da zona do jogo. **Nulo** no grupo de bosses que o time nunca pullou:
   * sem pull não há `gameZone`, e adivinhar a raid seria inventar.
   */
  id: z.number().int().nullable(),

  name: z.string(),

  /** Zona do WCL que contém estes bosses — o tier. */
  tier: z.string(),

  /** Bosses na ordem da raid. */
  bosses: bossProgressSchema.array(),
});
export type RaidProgress = z.infer<typeof raidProgressSchema>;

export const raidProgressReportSchema = z.object({
  season: seasonOptionSchema,

  /** Mesmo seletor do relatório de M+ — ver `seasonLabel()`. */
  availableSeasons: seasonOptionSchema.array(),

  /** Dificuldades com pull na season, da mais alta para a mais baixa. */
  difficulties: raidDifficultySchema.array(),

  raids: raidProgressSchema.array(),

  /** Quando o Warcraft Logs foi lido de fato. */
  fetchedAt: z.string(),

  /**
   * true = a leitura falhou e isto é o cache anterior.
   *
   * A tela avisa em vez de esconder: número de progressão velho apresentado
   * como atual é pior que número velho rotulado como velho.
   */
  stale: z.boolean(),
});
export type RaidProgressReport = z.infer<typeof raidProgressReportSchema>;

/**
 * Quantos bosses da raid já morreram numa dificuldade, sobre o total.
 *
 * É o "6/6" que a guilda usa para dizer onde está. O total é o número de
 * bosses da raid, não o número de bosses que tiveram pull — quem ainda não foi
 * pullado conta no denominador, senão a fração diz que o tier acabou.
 */
export function killedInDifficulty(
  raid: RaidProgress,
  difficulty: number,
): { killed: number; total: number } {
  const killed = raid.bosses.filter((b) =>
    b.byDifficulty.some((d) => d.difficulty === difficulty && d.kills > 0),
  ).length;

  return { killed, total: raid.bosses.length };
}
