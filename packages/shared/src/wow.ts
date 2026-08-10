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

/**
 * Stat primário de uma peça.
 *
 * É atributo da **peça**, não da spec: qual stat a spec usa é conhecimento
 * estático (Fury é força, sempre), enquanto o da peça varia item a item e
 * precisa ser cadastrado.
 *
 * Sempre um CONJUNTO, nunca um valor. Cobre os quatro casos reais com uma forma
 * só:
 *
 * - `[strength]` — peça de stat fixo, o caso comum de armadura de raid
 * - `[strength, agility]` — peça restrita a um grupo, comum em trinket
 * - `[strength, agility, intellect]` — peça totalmente adaptativa
 * - `[]` — peça sem primário nenhum, como trinket que é só efeito
 */
export const PRIMARY_STATS = {
  STRENGTH: 'strength',
  AGILITY: 'agility',
  INTELLECT: 'intellect',
} as const;
export const primaryStatSchema = z.nativeEnum(PRIMARY_STATS);
export type PrimaryStat = z.infer<typeof primaryStatSchema>;

/**
 * Dificuldade de raid: o vocabulário canônico do sistema.
 *
 * Mora aqui, e não no arquivo do catálogo, porque é conceito **do jogo** — e
 * porque não é só do catálogo: a linha de loot importada e a sessão ao vivo
 * usam o mesmo vocabulário. Ficar em `loot-catalog.ts` era confundir "onde foi
 * usado primeiro" com "de onde é".
 *
 * É **contexto da entrada do catálogo**, não algo derivado do item. Foi testado
 * nos 445 registros da season passada: dos 112 itens de raid, 75 aparecem em
 * mais de uma dificuldade, e só um bonus ID separa limpo. Quem cadastra está
 * lendo a loot table Mítica no Wowhead e já sabe que é mítica.
 *
 * (A origem real de uma peça sai do `itemContext` do `itemString` — ver TIT-76.
 * Isto aqui é o que a gente cadastra, não o que a gente deduz.)
 *
 * LFR ficou de fora porque a guilda não roda. Acrescentar valor depois é
 * migration barata; o inverso, não.
 *
 * NÃO CONFUNDIR com o `raidDifficultySchema` de `raid-progress.ts`, que é a
 * dificuldade **numerada pelo Warcraft Logs** (`{ id: 5, name: 'Mythic' }`) —
 * identificador de fonte externa que a gente recebe e repassa. O sufixo `Level`
 * aqui existe só para os dois não se confundirem no autocomplete, e o nome mal
 * aplicado é o de lá: ver TIT-78.
 */
export const RAID_DIFFICULTIES = {
  NORMAL: 'normal',
  HEROIC: 'heroic',
  MYTHIC: 'mythic',
} as const;
export const raidDifficultyLevelSchema = z.nativeEnum(RAID_DIFFICULTIES);
export type RaidDifficultyLevel = z.infer<typeof raidDifficultyLevelSchema>;

/**
 * Specs do jogo.
 *
 * O slug é prefixado pela classe porque o nome sozinho colide: `restoration` é
 * de druida e de xamã, `holy` é de paladino e de sacerdote, `frost` é de mago e
 * de death knight, `protection` é de paladino e de guerreiro.
 *
 * **Identidade estável, nunca posição.** Mesmo cuidado do enum de dificuldade e
 * pelo mesmo motivo: o `responseID` do RCLootCouncil é posicional, e por isso o
 * id `2` aparece como "Big" e como "Banking" no mesmo export. Spec muda entre
 * expansões — some, nasce, é renomeada — então o valor tem que ser o rótulo.
 */
export const SPECS = {
  DEATH_KNIGHT_BLOOD: 'death-knight-blood',
  DEATH_KNIGHT_FROST: 'death-knight-frost',
  DEATH_KNIGHT_UNHOLY: 'death-knight-unholy',
  DEMON_HUNTER_DEVOURER: 'demon-hunter-devourer',
  DEMON_HUNTER_HAVOC: 'demon-hunter-havoc',
  DEMON_HUNTER_VENGEANCE: 'demon-hunter-vengeance',
  DRUID_BALANCE: 'druid-balance',
  DRUID_FERAL: 'druid-feral',
  DRUID_GUARDIAN: 'druid-guardian',
  DRUID_RESTORATION: 'druid-restoration',
  EVOKER_AUGMENTATION: 'evoker-augmentation',
  EVOKER_DEVASTATION: 'evoker-devastation',
  EVOKER_PRESERVATION: 'evoker-preservation',
  HUNTER_BEAST_MASTERY: 'hunter-beast-mastery',
  HUNTER_MARKSMANSHIP: 'hunter-marksmanship',
  HUNTER_SURVIVAL: 'hunter-survival',
  MAGE_ARCANE: 'mage-arcane',
  MAGE_FIRE: 'mage-fire',
  MAGE_FROST: 'mage-frost',
  MONK_BREWMASTER: 'monk-brewmaster',
  MONK_MISTWEAVER: 'monk-mistweaver',
  MONK_WINDWALKER: 'monk-windwalker',
  PALADIN_HOLY: 'paladin-holy',
  PALADIN_PROTECTION: 'paladin-protection',
  PALADIN_RETRIBUTION: 'paladin-retribution',
  PRIEST_DISCIPLINE: 'priest-discipline',
  PRIEST_HOLY: 'priest-holy',
  PRIEST_SHADOW: 'priest-shadow',
  ROGUE_ASSASSINATION: 'rogue-assassination',
  ROGUE_OUTLAW: 'rogue-outlaw',
  ROGUE_SUBTLETY: 'rogue-subtlety',
  SHAMAN_ELEMENTAL: 'shaman-elemental',
  SHAMAN_ENHANCEMENT: 'shaman-enhancement',
  SHAMAN_RESTORATION: 'shaman-restoration',
  WARLOCK_AFFLICTION: 'warlock-affliction',
  WARLOCK_DEMONOLOGY: 'warlock-demonology',
  WARLOCK_DESTRUCTION: 'warlock-destruction',
  WARRIOR_ARMS: 'warrior-arms',
  WARRIOR_FURY: 'warrior-fury',
  WARRIOR_PROTECTION: 'warrior-protection',
} as const;
export const wowSpecSchema = z.nativeEnum(SPECS);
export type WowSpec = z.infer<typeof wowSpecSchema>;

/**
 * A classe de cada spec.
 *
 * Mapa explícito, e **não** um split do slug: `death-knight-frost` e
 * `demon-hunter-havoc` quebrariam qualquer regra de "corta no primeiro hífen",
 * e a que funciona hoje passa a errar calada quando nascer uma classe com nome
 * composto novo.
 *
 * As chaves referenciam `SPECS`; os valores ainda são literais porque `CLASSES`
 * segue como tupla. Vira `CLASSES.DEATH_KNIGHT` quando a TIT-78 converter.
 */
export const SPEC_CLASS: Record<WowSpec, WowClass> = {
  [SPECS.DEATH_KNIGHT_BLOOD]: 'death-knight',
  [SPECS.DEATH_KNIGHT_FROST]: 'death-knight',
  [SPECS.DEATH_KNIGHT_UNHOLY]: 'death-knight',
  [SPECS.DEMON_HUNTER_DEVOURER]: 'demon-hunter',
  [SPECS.DEMON_HUNTER_HAVOC]: 'demon-hunter',
  [SPECS.DEMON_HUNTER_VENGEANCE]: 'demon-hunter',
  [SPECS.DRUID_BALANCE]: 'druid',
  [SPECS.DRUID_FERAL]: 'druid',
  [SPECS.DRUID_GUARDIAN]: 'druid',
  [SPECS.DRUID_RESTORATION]: 'druid',
  [SPECS.EVOKER_AUGMENTATION]: 'evoker',
  [SPECS.EVOKER_DEVASTATION]: 'evoker',
  [SPECS.EVOKER_PRESERVATION]: 'evoker',
  [SPECS.HUNTER_BEAST_MASTERY]: 'hunter',
  [SPECS.HUNTER_MARKSMANSHIP]: 'hunter',
  [SPECS.HUNTER_SURVIVAL]: 'hunter',
  [SPECS.MAGE_ARCANE]: 'mage',
  [SPECS.MAGE_FIRE]: 'mage',
  [SPECS.MAGE_FROST]: 'mage',
  [SPECS.MONK_BREWMASTER]: 'monk',
  [SPECS.MONK_MISTWEAVER]: 'monk',
  [SPECS.MONK_WINDWALKER]: 'monk',
  [SPECS.PALADIN_HOLY]: 'paladin',
  [SPECS.PALADIN_PROTECTION]: 'paladin',
  [SPECS.PALADIN_RETRIBUTION]: 'paladin',
  [SPECS.PRIEST_DISCIPLINE]: 'priest',
  [SPECS.PRIEST_HOLY]: 'priest',
  [SPECS.PRIEST_SHADOW]: 'priest',
  [SPECS.ROGUE_ASSASSINATION]: 'rogue',
  [SPECS.ROGUE_OUTLAW]: 'rogue',
  [SPECS.ROGUE_SUBTLETY]: 'rogue',
  [SPECS.SHAMAN_ELEMENTAL]: 'shaman',
  [SPECS.SHAMAN_ENHANCEMENT]: 'shaman',
  [SPECS.SHAMAN_RESTORATION]: 'shaman',
  [SPECS.WARLOCK_AFFLICTION]: 'warlock',
  [SPECS.WARLOCK_DEMONOLOGY]: 'warlock',
  [SPECS.WARLOCK_DESTRUCTION]: 'warlock',
  [SPECS.WARRIOR_ARMS]: 'warrior',
  [SPECS.WARRIOR_FURY]: 'warrior',
  [SPECS.WARRIOR_PROTECTION]: 'warrior',
};

/**
 * `specID` do jogo → nossa spec.
 *
 * O número é o id da Blizzard, o mesmo que `GetSpecializationInfoForClassID`
 * devolve no cliente e que o dump do addon emite. É identidade estável, não
 * posição: `62` é Arcane desde sempre, e continua sendo se a Blizzard reordenar
 * a árvore de talentos.
 *
 * Existe para o dump do addon poder falar em número — o cliente só entrega nome
 * de spec **localizado**, então casar por nome quebraria num cliente ptBR sem
 * dar erro nenhum.
 *
 * Levantado do próprio cliente em 09/08/2026, iterando `GetNumClasses()` e
 * `GetNumSpecializationsForClassID()`: **40 specs**. Nosso enum tinha 39 — a
 * `demon-hunter-devourer` (1480) nasceu nesta expansão e faltava aqui.
 *
 * Id que não estiver neste mapa é **recusado**, nunca ignorado. Spec nova
 * silenciosamente descartada viraria item com uma spec a menos na lista de quem
 * pode dar need, e ninguém relacionaria as duas coisas.
 */
export const SPEC_BY_GAME_ID: Record<number, WowSpec> = {
  71: SPECS.WARRIOR_ARMS,
  72: SPECS.WARRIOR_FURY,
  73: SPECS.WARRIOR_PROTECTION,
  65: SPECS.PALADIN_HOLY,
  66: SPECS.PALADIN_PROTECTION,
  70: SPECS.PALADIN_RETRIBUTION,
  253: SPECS.HUNTER_BEAST_MASTERY,
  254: SPECS.HUNTER_MARKSMANSHIP,
  255: SPECS.HUNTER_SURVIVAL,
  259: SPECS.ROGUE_ASSASSINATION,
  260: SPECS.ROGUE_OUTLAW,
  261: SPECS.ROGUE_SUBTLETY,
  256: SPECS.PRIEST_DISCIPLINE,
  257: SPECS.PRIEST_HOLY,
  258: SPECS.PRIEST_SHADOW,
  250: SPECS.DEATH_KNIGHT_BLOOD,
  251: SPECS.DEATH_KNIGHT_FROST,
  252: SPECS.DEATH_KNIGHT_UNHOLY,
  262: SPECS.SHAMAN_ELEMENTAL,
  263: SPECS.SHAMAN_ENHANCEMENT,
  264: SPECS.SHAMAN_RESTORATION,
  62: SPECS.MAGE_ARCANE,
  63: SPECS.MAGE_FIRE,
  64: SPECS.MAGE_FROST,
  265: SPECS.WARLOCK_AFFLICTION,
  266: SPECS.WARLOCK_DEMONOLOGY,
  267: SPECS.WARLOCK_DESTRUCTION,
  268: SPECS.MONK_BREWMASTER,
  269: SPECS.MONK_WINDWALKER,
  270: SPECS.MONK_MISTWEAVER,
  102: SPECS.DRUID_BALANCE,
  103: SPECS.DRUID_FERAL,
  104: SPECS.DRUID_GUARDIAN,
  105: SPECS.DRUID_RESTORATION,
  577: SPECS.DEMON_HUNTER_HAVOC,
  581: SPECS.DEMON_HUNTER_VENGEANCE,
  1480: SPECS.DEMON_HUNTER_DEVOURER,
  1467: SPECS.EVOKER_DEVASTATION,
  1468: SPECS.EVOKER_PRESERVATION,
  1473: SPECS.EVOKER_AUGMENTATION,
};

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
