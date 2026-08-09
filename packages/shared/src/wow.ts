import { z } from 'zod';

/**
 * Vocabulário do domínio WoW, compartilhado entre front e back.
 *
 * Manter aqui (e não duplicado em cada app) porque esses valores aparecem em
 * validação de formulário, filtros de roster e mapeamento das APIs da Blizzard.
 */

/**
 * Regiões da Blizzard. O enum completo existe porque os endpoints são por
 * região e o valor precisa ser tipado — não porque o site atenda todas.
 *
 * A guilda é **exclusivamente US**, então a região é configuração fixa do
 * servidor (`BLIZZARD_REGION`), nunca escolha de quem preenche formulário.
 *
 * Cuidado: região US ≠ jogadores americanos. Realms brasileiros (Azralon,
 * Goldrinn, Nemesis, Tol Barad…) são região US. Nunca inferir região a partir
 * de IP, idioma do navegador ou nacionalidade — só do realm do personagem.
 */
export const REGIONS = ['us', 'eu', 'kr', 'tw', 'cn'] as const;
export const regionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof regionSchema>;

export const CLASSES = [
  'death-knight',
  'demon-hunter',
  'druid',
  'evoker',
  'hunter',
  'mage',
  'monk',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
] as const;
export const wowClassSchema = z.enum(CLASSES);
export type WowClass = z.infer<typeof wowClassSchema>;

export const ROLES = ['tank', 'healer', 'melee-dps', 'ranged-dps'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Marcas diacríticas combinantes (Unicode Combining Diacritical Marks). */
const COMBINING_MARKS = /[̀-ͯ]/g;
const APOSTROPHES = /['’]/g;

/**
 * Letras latinas que o NFD **não** decompõe, porque não são letra base +
 * acento — são caracteres próprios.
 *
 * Encontrado em dado real: o roster tinha "Håøkåh". O `å` foi normalizado
 * (é a + anel combinante), mas o `ø` sobreviveu, gerando "haøkah". Quem
 * digitasse "Haokah" no formulário de apply não casaria com o roster.
 */
const LATIN_SPECIALS: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  đ: 'd',
  ł: 'l',
  ħ: 'h',
  ŋ: 'n',
  ı: 'i',
};
const LATIN_SPECIALS_RE = new RegExp(`[${Object.keys(LATIN_SPECIALS).join('')}]`, 'g');

/**
 * Normaliza **realm**, ou nome digitado por uma pessoa, para comparação.
 *
 * Necessário porque a Blizzard devolve realm como slug (`area-52`) em alguns
 * endpoints e como nome exibido (`Area 52`) em outros. A meta é ser tolerante
 * com quem **digita**: "Zecolmeia" tem que casar com "Zécolmeia" do roster.
 *
 * NÃO use para identificar personagem vindo da API — remove acento, e acento
 * distingue personagens diferentes. Use `toCharacterKey`.
 */
export function toSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(LATIN_SPECIALS_RE, (c) => LATIN_SPECIALS[c] ?? c)
    .replace(APOSTROPHES, '')
    .replace(/[\s_]+/g, '-');
}

/**
 * Chave de realm para casar **fontes diferentes** entre si.
 *
 * `toSlug()` não serve para isso, e o motivo é concreto: cada ferramenta
 * escreve realm composto de um jeito.
 *
 * | fonte              | Area 52   | Demon Soul   |
 * | ------------------ | --------- | ------------ |
 * | Blizzard / WoWAudit| `Area 52` | `Demon Soul` |
 * | Warcraft Logs      | `Area52`  | `DemonSoul`  |
 *
 * Pelo `toSlug()` isso vira `area-52` de um lado e `area52` do outro — e o
 * casamento falha **em silêncio**. Na noite de 28/07/2026, Decenty-DemonSoul e
 * Kusiak-Area52 estavam no log e seriam gravados como "Não Raidou": acusação de
 * furo contra quem raidou. Não é caso de borda: **58 dos 344 realms US** têm
 * hífen no slug.
 *
 * A chave tira todo separador depois do `toSlug()`. Verificado contra o índice
 * de realms da Blizzard: os 344 realms US geram **344 chaves distintas**, zero
 * colisão — colapsar separador não junta realms diferentes.
 *
 * Use **só** para comparar realm entre fontes. O que vai para o banco e para os
 * endpoints da Blizzard continua sendo `toSlug()`, que é o formato que a
 * Blizzard aceita na URL.
 */
export function toRealmMatchKey(realm: string): string {
  return toSlug(realm).replace(/[^a-z0-9]/g, '');
}

/**
 * Identidade de um personagem vindo da API da Blizzard.
 *
 * **Preserva acento de propósito.** WoW não permite dois personagens com o mesmo
 * nome no mesmo realm, então quem chega e encontra o nome ocupado registra uma
 * variação acentuada dele. Não é enfeite: é a forma de conseguir o nome que a
 * pessoa queria. Por isso variação acentuada é comum, e por isso ela distingue
 * personagens diferentes, com ranks diferentes.
 *
 * A consequência prática: a identidade de um personagem é sempre o par
 * **nome + realm**, nunca o nome sozinho. No roster da Titan Inc as colisões
 * aparecem em 7 grupos, entre eles:
 *
 * ```
 * azralon/Shrëwd (rank 5) · Shrêwd (rank 5) · Shrèwd (rank 7)
 * azralon/Jöci   (rank 7) · Joci   (rank 5) · Jôci   (rank 7)
 * ```
 *
 * Usar `toSlug` aqui colapsa os três em `shrewd`. Num `Map` isso faz o último
 * sobrescrever os outros, e a pessoa passa a ser lida com o rank de um
 * personagem que não é dela — o que decide acesso à área interna.
 *
 * Só normaliza o que a própria Blizzard varia entre endpoints:
 *
 * - **NFC**, porque `ë` pode vir como um code point ou como `e` + combining
 *   diaeresis, e as duas formas não são iguais em `===`;
 * - **minúsculas**, porque a capitalização varia.
 *
 * Para nome **digitado** por uma pessoa, use `toSlug`: ali a tolerância a
 * acento é desejável, porque ninguém quer errar apply por causa de trema.
 */
export function toCharacterKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/**
 * Identidade de um personagem, do jeito que as APIs da Blizzard esperam
 * (região inclusa, porque o endpoint depende dela).
 *
 * Para entrada de usuário, use `characterInputSchema` — quem preenche
 * formulário não escolhe região.
 */
export const characterRefSchema = z.object({
  name: z.string().min(2).max(12),
  realm: z.string().min(2).max(64),
  region: regionSchema,
});
export type CharacterRef = z.infer<typeof characterRefSchema>;

/**
 * Identidade de personagem vinda de formulário: sem região.
 *
 * A região é preenchida pelo servidor a partir da config da guilda. Deixar o
 * candidato escolher entre 5 regiões só cria um jeito de errar: ele marca "eu",
 * a busca do personagem falha, e a mensagem de erro não explica o porquê.
 */
export const characterInputSchema = characterRefSchema.omit({ region: true });
export type CharacterInput = z.infer<typeof characterInputSchema>;
