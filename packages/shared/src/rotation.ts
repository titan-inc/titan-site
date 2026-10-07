import { z } from 'zod';

/**
 * Rotação de banco: quem descansa nesta semana.
 *
 * O banco **não é público**. Quando a liderança diz que alguém vai sentar, é
 * esperado que a pessoa apareça na raid mesmo assim, para o caso de precisar
 * trocar — divulgar antes faz a pessoa não aparecer. Ver a Regra 7 do
 * CLAUDE.md; nada daqui sai em payload que um membro alcance.
 */

/**
 * Role do time, como o WoWAudit nomeia.
 *
 * As quatro cabem num campo só porque o WoWAudit já separa melee de ranged ali
 * — o que faz "travar role" e "travar melee/ranged" serem o mesmo mecanismo.
 */
export const ROTATION_ROLES = ['Tank', 'Heal', 'Melee', 'Ranged'] as const;
export const rotationRoleSchema = z.enum(ROTATION_ROLES);
export type RotationRole = z.infer<typeof rotationRoleSchema>;

/** Quantos sentam quando o oficial não disse outra coisa. */
export const DEFAULT_ROTATION_SEATS = 5;

/**
 * Por que alguém está fora da rotação.
 *
 * `role` é o toggle da tela (hoje os tanks não rotacionam). `player` é a trava
 * na pessoa, e ela carrega `weeks` justamente porque o risco dela é sobreviver
 * ao motivo — a tela mostra há quanto tempo está lá para alguém revisar.
 */
export const rotationLockSchema = z.object({
  kind: z.enum(['role', 'player']),
  reason: z.string(),
  /** Só para `player`: há quantas semanas a trava existe. */
  weeks: z.number().int().nullable(),
  /** Só para `player`: o id da trava, para revogar. */
  id: z.string().nullable(),
});
export type RotationLock = z.infer<typeof rotationLockSchema>;

/** Uma pessoa do time, com o que a rotação precisa saber dela. */
export const rotationPlayerSchema = z.object({
  characterId: z.string(),

  /** Identidade é nome + realm, nunca o nome sozinho — Regra 6. */
  name: z.string(),
  realm: z.string(),

  /** Classe como o WoWAudit devolve ("Death Knight"), string crua. */
  wowClass: z.string(),
  role: rotationRoleSchema,

  /**
   * Semanas desde o último banco **cumprido**.
   *
   * Null = nunca sentou, ou não há registro — e nesse caso a pessoa vai para a
   * frente da fila, que é o comportamento certo.
   */
  weeksSinceBench: z.number().int().nullable(),

  /** Fora da rotação, e por quê. Null = entra no sorteio. */
  lock: rotationLockSchema.nullable(),
});
export type RotationPlayer = z.infer<typeof rotationPlayerSchema>;

/**
 * Uma linha da sugestão.
 *
 * `reason` existe porque um banco que o raid leader não consegue explicar no
 * Discord não serve, mesmo estando certo — e explicar é o trabalho real dele,
 * não calcular.
 */
export const rotationSuggestionSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  realm: z.string(),
  role: rotationRoleSchema,
  reason: z.string(),

  /**
   * Posto no banco à mão pelo raid leader, e **não sai no recálculo**.
   *
   * O caso: numa luta em que a classe rende mal, o RL senta aquela pessoa mesmo
   * que a conta não a escolhesse. A fixação consome vaga da role dela, então o
   * banco continua proporcional — o que muda é quem ocupa a vaga, não quantas
   * cada role recebe.
   */
  pinned: z.boolean(),
});
export type RotationSuggestion = z.infer<typeof rotationSuggestionSchema>;

/** O plano já salvo de uma semana. */
export const rotationSavedPlanSchema = z.object({
  seats: z.number().int(),
  characterIds: z.string().array(),
  /** Subconjunto de `characterIds` que o RL fixou à mão. */
  pinned: z.string().array(),
  savedBy: z.string(),
  savedAt: z.string(),
});
export type RotationSavedPlan = z.infer<typeof rotationSavedPlanSchema>;

/** Tudo que a tela de rotação precisa, numa chamada. */
export const rotationViewSchema = z.object({
  /** Segunda-feira da semana, no fuso da guilda. "2026-09-28". */
  weekStart: z.string(),

  /** Quantos sentar. Vem do plano salvo, ou do default. */
  seats: z.number().int(),

  /** Roles fora da rotação. */
  roleLocks: rotationRoleSchema.array(),

  /** O time inteiro, travados inclusive — a tela mostra quem está fora e por quê. */
  pool: rotationPlayerSchema.array(),

  /** A sugestão, já respeitando travas e `seats`. Nunca é o plano. */
  suggestion: rotationSuggestionSchema.array(),

  /** O que o oficial salvou para esta semana, se salvou. */
  saved: rotationSavedPlanSchema.nullable(),

  /**
   * O time veio de cache velho porque o WoWAudit falhou.
   *
   * A tela avisa em vez de esconder: decidir banco com um time desatualizado é
   * sentar alguém que já saiu, ou não sentar quem entrou.
   */
  teamStale: z.boolean(),
});
export type RotationView = z.infer<typeof rotationViewSchema>;

/** Substitui o conjunto inteiro de roles travadas. */
export const setRoleLocksSchema = z.object({
  roles: rotationRoleSchema.array(),
});
export type SetRoleLocks = z.infer<typeof setRoleLocksSchema>;

/**
 * Trava uma pessoa.
 *
 * `characterId` e não nome digitado: a tela escolhe de uma lista de 26, então
 * não existe o problema de nome ambíguo que o `OfficerGrant` precisa resolver.
 */
export const createPlayerLockSchema = z.object({
  characterId: z.string().min(1),
  /** Obrigatório — ver `RotationPlayerLock` no schema do Prisma. */
  reason: z.string().trim().min(3).max(200),
});
export type CreatePlayerLock = z.infer<typeof createPlayerLockSchema>;

/** Salva (ou substitui) o plano da semana. */
export const savePlanSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.number().int().min(0).max(40),
  characterIds: z.string().array(),
  /**
   * Quem foi fixado à mão. Tem que ser subconjunto de `characterIds` — fixar
   * alguém que não está no banco não quer dizer nada, e o service recusa.
   */
  pinned: z.string().array().default([]),
});
export type SavePlan = z.infer<typeof savePlanSchema>;

/**
 * Semanas entre duas segundas-feiras, pelo calendário.
 *
 * Pura e no shared porque o job e a tela precisam do mesmo número, e duas
 * implementações divergiriam em silêncio — do jeito que a Regra 2 evita.
 */
export function semanasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

/**
 * A segunda-feira da semana de uma data de calendário.
 *
 * Opera na string, sem fuso: a data já chega no fuso da guilda, e converter
 * para `Date` local aqui traria de volta o bug de datar a noite no dia errado
 * que a Regra 6 descreve.
 */
export function inicioDaSemana(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // getUTCDay: 0 = domingo. Domingo pertence à semana que começou na segunda
  // anterior, então ele volta 6 dias, não 0.
  const diasDesdeSegunda = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diasDesdeSegunda);
  return d.toISOString().slice(0, 10);
}

/**
 * O texto que a tela mostra ao lado de quem foi sugerido.
 *
 * O vocabulário é **"foi banco"**, e não "sentou", por pedido da liderança: a
 * tela fala sobre pessoas que vão ler o que está escrito sobre elas, e "nunca
 * sentou" lia como cobrança. Trocar só aquele caso deixaria a tela misturando
 * dois vocabulários, então os quatro acompanham.
 *
 * Não é preciosismo: é a mesma razão de "Não raidou" não ser vermelho na tela
 * de presença — o sistema descreve um fato, não emite um juízo.
 */
export function motivoDaSugestao(weeksSinceBench: number | null): string {
  if (weeksSinceBench === null) return 'ainda não foi banco';
  if (weeksSinceBench <= 0) return 'foi banco esta semana';
  if (weeksSinceBench === 1) return '1 semana sem banco';
  return `${weeksSinceBench} semanas sem banco`;
}
