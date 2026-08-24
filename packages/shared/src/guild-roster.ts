import { z } from 'zod';

/**
 * Um personagem do roster **da guilda** (~590), não do time de raid.
 *
 * Não confundir com `RosterEntry` (ver `roster.ts`): aquele é a curadoria do
 * WoWAudit para as ~22 pessoas que raidam; este é o roster inteiro, direto da
 * Blizzard. Ver Regra 4 do CLAUDE.md — o rank aqui é o mesmo que decide acesso
 * à área interna e status de oficial.
 *
 * Só oficial vê esta lista: rank, nível e classe já estão abertos no Logs e no
 * WoWAudit (Regra 4, "filtro de conteúdo, não fronteira de segurança"), mas o
 * battletag é dado pessoal de verdade — não sai da Blizzard para conta alheia,
 * e a lista inteira junto vira uma ferramenta de contato.
 */
export const guildRosterMemberSchema = z.object({
  /** Nome como a Blizzard exibe, com acento. */
  name: z.string(),
  /** Realm como a Blizzard exibe ("Area 52"). A identidade é nome + realm — Regra 6. */
  realm: z.string(),

  level: z.number().int().nonnegative(),

  /**
   * Nome da classe como a Blizzard devolve ("Mage", "Death Knight") — sem
   * tradução nem normalização para o token que outras fontes usam ("MAGE").
   * Nulo é lacuna (a fonte não trouxe), nunca "sem classe" — mesma régua do
   * `Character.class` no schema do Prisma.
   */
  wowClass: z.string().nullable(),

  /**
   * Posição no roster da guilda. Rank 0 é o mais alto (guild master) — Regra 4.
   * A Blizzard não devolve nome de rank, só a posição.
   */
  rank: z.number().int().nonnegative(),

  /**
   * Battletag da conta dona do personagem, só quando ela já logou no site pelo
   * menos uma vez. Nulo é o caso comum: a Blizzard não expõe battletag de
   * conta alheia (só via `/oauth/userinfo` da própria pessoa), então quem
   * nunca autenticou aqui não tem como aparecer.
   */
  battletag: z.string().nullable(),
});
export type GuildRosterMember = z.infer<typeof guildRosterMemberSchema>;

export const guildRosterSchema = z.object({
  members: guildRosterMemberSchema.array(),
  fetchedAt: z.string().datetime(),
});
export type GuildRosterResponse = z.infer<typeof guildRosterSchema>;
