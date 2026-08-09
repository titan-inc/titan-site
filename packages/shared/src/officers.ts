import { z } from 'zod';
import { characterInputSchema, toCharacterKey, toSlug, type CharacterInput } from './wow.js';

/**
 * Concessão de status de oficial — a lista manual da Regra 4.
 *
 * É **por personagem**, e não por conta, por um motivo prático: a flag precisa
 * poder ser dada antes de a pessoa logar no site pela primeira vez. Conta só
 * existe depois do OAuth, e o roster da Blizzard não diz de qual conta é cada
 * personagem, então esperar o login para poder promover deixaria a liderança
 * sem como preparar a lista.
 *
 * Continua **manual e nunca derivada de rank**, que é o que a Regra 4 exige:
 * quem escreve a lista é uma pessoa, personagem por personagem. Errar o
 * mapeamento para cima expõe dado pessoal de centenas de candidatos, e rank é
 * posicional — reordenar rank no jogo não pode promover ninguém.
 */

/**
 * Um personagem como identidade, do jeito que o sistema guarda.
 *
 * Sempre o par nome + realm, nunca o nome sozinho — Regra 6. `nameKey` vem de
 * `toCharacterKey()` (mantém acento) e `realmSlug` de `toSlug()`.
 */
export interface OfficerCharacterRef {
  nameKey: string;
  realmSlug: string;
}

/**
 * Chave de casamento entre um personagem e um grant.
 *
 * Normaliza os dois lados na hora de comparar, e não só na hora de gravar: o
 * grant pode ter sido inserido à mão no banco, e comparar string crua contra
 * linha escrita à mão falha em silêncio. Mesma composição usada na revalidação
 * de membership, de propósito — se as duas divergirem, uma pessoa vira oficial
 * num caminho e não no outro.
 */
function matchKey(ref: OfficerCharacterRef): string {
  return `${toSlug(ref.realmSlug)}/${toCharacterKey(ref.nameKey)}`;
}

/**
 * A conta é de oficial?
 *
 * Verdadeiro quando **qualquer** personagem da conta casa com **qualquer**
 * grant. É a mesma agregação por pessoa da Regra 4: quem raida em Zenithus e
 * tem grant no alt continua sendo a mesma pessoa, e quem verifica um personagem
 * só erra silenciosamente.
 *
 * Não recebe rank de propósito. Se um dia esta função aceitar rank, a Regra 4
 * foi violada.
 */
export function isOfficerByGrants(
  characters: readonly OfficerCharacterRef[],
  grants: readonly OfficerCharacterRef[],
): boolean {
  if (characters.length === 0 || grants.length === 0) return false;

  const concedidos = new Set(grants.map(matchKey));
  return characters.some((char) => concedidos.has(matchKey(char)));
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

export const officerGrantSchema = z.object({
  id: z.string(),

  /** Nome como a Blizzard exibe, com acento. */
  name: z.string(),
  realm: z.string(),

  /** Identidade normalizada. O front usa para chave de lista, não para exibir. */
  nameKey: z.string(),
  realmSlug: z.string(),

  /**
   * Rank do personagem no roster **agora**. Null = não está mais no roster.
   *
   * Exibição pura: não decide nada sobre o acesso. Serve para a liderança ver
   * que um grant ficou apontando para alguém que saiu da guilda.
   */
  rank: z.number().int().nullable(),

  /**
   * Já existe conta que casou com este grant?
   *
   * Falso significa "concedido, mas a pessoa ainda não logou no site nenhuma
   * vez". Sem este campo, um grant correto e um grant com nome errado ficam
   * visualmente idênticos na tela — e o segundo só apareceria como "não tenho
   * acesso" semanas depois.
   */
  linked: z.boolean(),

  /** Battletag de quem concedeu. Registro de quem decidiu, não de quem clicou. */
  grantedBy: z.string(),
  grantedAt: z.string(),
});
export type OfficerGrant = z.infer<typeof officerGrantSchema>;

export const officerListSchema = z.object({
  grants: z.array(officerGrantSchema),
});
export type OfficerList = z.infer<typeof officerListSchema>;
