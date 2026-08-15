import { z } from 'zod';
import { characterInputSchema, type CharacterInput } from './wow.js';

/**
 * Quem é oficial — Regra 4. Duas fontes independentes, basta uma:
 * rank na guilda (`isOfficerByRank`) ou concessão manual (`isOfficerByGrants`).
 *
 * A concessão é **por personagem** porque precisa poder ser dada antes do
 * primeiro login — conta só existe depois do OAuth.
 */

/**
 * Um personagem como identidade, do jeito que o sistema guarda.
 *
 * Depois da TIT-132 um personagem é um **id de identidade**, e o casamento
 * virou interseção de ids. Antes eram dois pares (nome, realm) normalizados na
 * hora de comparar, porque um grant inserido à mão no banco podia ter grafia
 * diferente — com id, grafia deixou de participar da conta.
 */

/**
 * A conta é de oficial?
 *
 * Verdadeiro quando **qualquer** personagem da conta casa com **qualquer**
 * grant. É a mesma agregação por pessoa da Regra 4: quem raida em Zenithus e
 * tem grant no alt continua sendo a mesma pessoa, e quem verifica um personagem
 * só erra silenciosamente.
 *
 * Não recebe rank de propósito: são duas fontes separadas, e quem as combina é
 * o servidor.
 */
export function isOfficerByGrants(
  characterIds: readonly string[],
  grantedCharacterIds: readonly string[],
): boolean {
  if (characterIds.length === 0 || grantedCharacterIds.length === 0) return false;

  const concedidos = new Set(grantedCharacterIds);
  return characterIds.some((id) => concedidos.has(id));
}

/**
 * A conta é de oficial **pelo rank na guilda**? (DECISÃO 2026-08-10)
 *
 * `officerRankMax` vem de `GUILD_OFFICER_RANK_MAX` — **nunca escreva o número
 * aqui**: rank é posicional, e reordenar ranks no jogo muda quem é oficial sem
 * erro nenhum. Ver Regra 4.
 *
 * `guildRank` é o **melhor** rank da conta, então um alt em rank de oficial
 * promove a pessoa inteira. Consequência aceita, não descuido.
 */
export function isOfficerByRank(guildRank: number | null, officerRankMax: number): boolean {
  if (guildRank === null) return false;
  return guildRank <= officerRankMax;
}

/**
 * Personagem a promover, vindo do formulário.
 *
 * É o **mesmo** schema de personagem digitado do resto do site, e não uma
 * redeclaração: Regra 2 — o campo nasce num lugar só. Sem região, porque a
 * guilda é US-only e o servidor resolve isso.
 */
export const createOfficerGrantSchema = characterInputSchema;
export type CreateOfficerGrant = CharacterInput;

/** O que as duas fontes têm em comum na tela. */
const officerBaseSchema = z.object({
  /** Nome como a Blizzard exibe, com acento. */
  name: z.string(),
  realm: z.string(),

  /** Identidade normalizada. O front usa para chave de lista, não para exibir. */
  nameKey: z.string(),
  realmSlug: z.string(),

  /**
   * Já existe conta que casou com este personagem? Falso = "é oficial, mas
   * nunca logou". Sem isto, um grant certo e um com nome errado ficam
   * idênticos na tela.
   */
  linked: z.boolean(),
});

export const officerGrantSchema = officerBaseSchema.extend({
  id: z.string(),

  /**
   * Rank no roster **agora**. Null = saiu da guilda. Exibição pura — mostra
   * grant apontando para quem saiu, e grant que virou redundante.
   */
  rank: z.number().int().nullable(),

  /** Battletag de quem concedeu. Registro de quem decidiu, não de quem clicou. */
  grantedBy: z.string(),
  grantedAt: z.string(),
});
export type OfficerGrant = z.infer<typeof officerGrantSchema>;

/**
 * Oficial **pelo rank**, sem concessão por trás.
 *
 * Sem `id`/`grantedBy`/`grantedAt` de propósito: não há o que revogar. Dois
 * arrays em vez de união com campos nulos é o que impede a tela de oferecer um
 * "Revogar" que a API não honraria.
 */
export const officerByRankSchema = officerBaseSchema.extend({
  /** Nunca nulo: esta pessoa está na lista *porque* o roster devolveu o rank. */
  rank: z.number().int(),
});
export type OfficerByRank = z.infer<typeof officerByRankSchema>;

export const officerListSchema = z.object({
  grants: z.array(officerGrantSchema),

  /**
   * Oficiais automáticos, do roster de agora. Vem junto porque a tela se chama
   * "Oficiais" — só os grants não explicaria quem mais tem acesso. Derivada,
   * não armazenada.
   */
  byRank: z.array(officerByRankSchema),

  /** O corte em vigor, para a tela explicar de onde `byRank` saiu. */
  officerRankMax: z.number().int().nonnegative(),

  /**
   * O roster respondeu? Falso = `byRank` está vazio por falta de dado, não por
   * não existir ninguém. Sem isto a tela afirmaria zero onde a verdade é "não
   * sei" — Regra 7, lacuna nunca vira zero.
   */
  rosterOk: z.boolean(),
});
export type OfficerList = z.infer<typeof officerListSchema>;
