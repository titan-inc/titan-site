import { z } from 'zod';
import { lootResponseKindSchema, lootResponseSlugSchema } from './loot-response.js';
import { raidDifficultyLevelSchema } from './wow.js';

/**
 * Um personagem numa linha de loot.
 *
 * Sempre o par nome + realm, nunca o nome sozinho — Regra 6. Identidade
 * normalizada para comparar, grafia da fonte para exibir.
 *
 * O realm de exibição é guardado, e não derivado da chave, porque o caminho de
 * volta é lossy: a chave frouxa colapsa todo separador, e `area52` não reconstrói
 * "Area 52".
 *
 * Usado pelo **histórico pronto para tela** (`LootHistoryEntry`), não pela
 * `LootLine` — ali quem identifica é `winnerCharacterId`/`looterCharacterId`, e
 * é quem resolve a grafia na leitura.
 */
export const lootCharacterSchema = z.object({
  /** Grafia da fonte. Para exibir, nunca para comparar. */
  name: z.string(),
  realm: z.string(),

  /**
   * Identidade. `nameKey` mantém acento (`toCharacterKey`).
   *
   * O realm é a chave FROUXA (`toRealmMatchKey`), não `toSlug`: a linha de loot
   * nasce de fonte que escreve realm à moda do cliente do jogo — o export do
   * RCLootCouncil traz `Area52` e `DemonSoul`, e o roster da Blizzard guarda
   * `area-52` e `demon-soul`. Mesma escolha do `Attendance.realmKey`, pelo mesmo
   * motivo, e é `toRealmMatchKey()` no slug do roster que faz a ponte.
   */
  nameKey: z.string(),
  realmKey: z.string(),
});
export type LootCharacter = z.infer<typeof lootCharacterSchema>;

/**
 * De onde a linha de loot veio.
 *
 * Não é detalhe de auditoria: decide o que se pode afirmar sobre a linha. Import
 * do RCLootCouncil traz o registro de origem inteiro em `rawImportedLine` e
 * `encounterId` que muitas vezes não resolve; sessão ao vivo nasce com o boss já
 * identificado e sem bruto nenhum a guardar.
 */
export const LOOT_LINE_SOURCES = {
  IMPORT_RC: 'import_rc',
  IMPORT_WOWAUDIT: 'import_wowaudit',
  LIVE_SESSION: 'live_session',
} as const;

export const lootLineSourceSchema = z.nativeEnum(LOOT_LINE_SOURCES);
export type LootLineSource = z.infer<typeof lootLineSourceSchema>;

/**
 * Uma peça entregue a alguém por decisão do conselho.
 *
 * **Uma linha é um award, não a resposta de um candidato.** Medido no export
 * real: 444 drops distintos em 445 linhas. A resposta aqui é a de **quem
 * levou**, no momento em que levou.
 *
 * Só entra loot distribuído pelo conselho. Bonus roll e personal loot vão direto
 * para o jogador e são propriedade exclusiva dele — não houve decisão a
 * registrar.
 *
 * **A tabela é o registro da decisão do NOSSO conselho — o import se adapta a
 * ela, não o contrário** (TIT-130). Por isso os campos abaixo são os da nossa
 * estrutura, e a fonte importada vira uma coluna só: `rawImportedLine`.
 */
export const lootLineSchema = z.object({
  id: z.string(),
  source: lootLineSourceSchema,

  /**
   * Id da linha na fonte. No RCLootCouncil é `servertime-índice`.
   *
   * **NOT NULL.** É o que dá trava de duplicata: reimportar o mesmo arquivo
   * atualiza em vez de duplicar, e a sessão ao vivo (TIT-69) gera o seu a partir
   * do `LootSessionItem.id` — há um award por item, então o id do item é a
   * chave natural da entrega. É o que torna o encerramento idempotente.
   */
  externalId: z.string().min(1),

  /**
   * De volta para quem pediu, quem votou e quem decidiu.
   *
   * Nulo é import: quem pediu e não levou, e quem ficou em silêncio, moram na
   * `LootSession` e nas tabelas dela — o `LootSessionEvent`, append-only,
   * reconstrói a sessão inteira. Não é lacuna, é o dado morando onde já está
   * completo, em vez de espremido numa tabela cuja unidade é a peça entregue.
   */
  sessionId: z.string().nullable(),

  awardedAt: z.string().datetime(),

  /**
   * Quem entregou. **Sem FK para `User`** — mesmo precedente de
   * `LootSession.createdBy` e `OfficerGrant.grantedBy`: registro não se apaga
   * por exclusão de conta, e o battletag deixa a auditoria legível sem join.
   *
   * Os dois nulos juntos, e só no import: sessão ao vivo sempre sabe quem
   * awardou.
   */
  awardedByUserId: z.string().nullable(),
  awardedByBattletag: z.string().nullable(),

  /**
   * A season em que a entrega ACONTECEU, não o tier da peça — ver o comentário
   * em `LootLine.seasonId` no schema. Nulo é lacuna: entrega anterior a toda
   * season conhecida, ou importada antes do job de snapshot criar a linha.
   */
  seasonId: z.number().int().positive().nullable(),

  /** Quem levou a peça. Aponta para `Character`, sobrevive a quem saiu da guilda. */
  winnerCharacterId: z.string(),

  /**
   * Quem lootou no jogo, quando a fonte diz. Nulo quando ela não diz — e não é
   * o mesmo que "lootou para si": ler isto como destinatário inverte o
   * propósito da ferramenta.
   */
  looterCharacterId: z.string().nullable(),

  itemId: z.number().int().positive(),

  /**
   * O `itemString` cru e inteiro, sem interpretar.
   *
   * Hoje não sabemos o que distingue o bônus `13333` do `13335`. Preservar o
   * bruto é o que permite enriquecer o histórico retroativamente quando alguém
   * mapear a família de track.
   */
  itemString: z.string(),

  /**
   * O boss do catálogo, quando resolveu. **Só o `encounterId`** — raid e tier já
   * vêm dele pelo catálogo, e não há mais bruto de instância/boss na linha: isso
   * vira `rawImportedLine`.
   *
   * Nulo em 22% do histórico importado, por nome traduzido ou boss desconhecido.
   * Quem consome trata nulo como "não deu para identificar", nunca como erro —
   * e a tela mostra a lacuna, nunca o texto interno de outra ferramenta.
   */
  encounterId: z.string().nullable(),

  /**
   * Dificuldade **da peça**, do `itemContext` — não a da sala onde ela foi
   * entregue. As duas divergem legitimamente; ver `raidDifficultyFromItemString`.
   *
   * Nulo quando não deu para determinar. Lacuna, nunca `normal` por omissão.
   */
  difficulty: raidDifficultyLevelSchema.nullable(),

  /**
   * A resposta, no vocabulário do sistema.
   *
   * Slug, e não enum fechado: as opções são uma tabela configurável, e quem
   * valida é a linha em `LootResponseOption`.
   */
  responseOptionSlug: lootResponseSlugSchema,

  /**
   * O `kind` da resposta, **congelado no momento da entrega** — nunca o `kind`
   * atual da opção, que a TIT-64 torna editável.
   *
   * É o que distingue peça entregue a quem a pediu (`player`) de peça que o
   * loot master mandou para o banco (`loot_master`): sem isso, quem carrega o
   * banco da guilda acumula histórico de peças que nunca usou, e lidera as
   * agregações de "quem mais recebeu loot". Nunca nulo.
   */
  responseKind: lootResponseKindSchema,

  /** Zero é resultado legítimo; nulo é fonte que não tem o conceito de voto. */
  votes: z.number().int().nonnegative().nullable(),

  /**
   * A nota de quem pediu a peça — o addon do RCLootCouncil não oferece campo de
   * nota ao loot master, então tudo que a fonte trazia aqui era do jogador.
   */
  playerNote: z.string().nullable(),

  /**
   * A justificativa do conselho. Não existia no import; nasce com a sessão ao
   * vivo.
   */
  councilNote: z.string().nullable(),

  /**
   * O registro de origem **inteiro**, como veio da fonte. `Json` livre, e não
   * campos escolhidos: um `rawBoss`/`rawInstance` picados já se mostrou perda —
   * 56 dos 77 registros sem boss resolvido tinham `rawBoss` igual a `Unknown` ou
   * `Desconhecido`, texto interno de outra ferramenta com cara de dado nosso.
   *
   * Nulo na sessão ao vivo, que nasce no nosso formato e não tem fonte externa a
   * preservar.
   */
  rawImportedLine: z.record(z.string(), z.unknown()).nullable(),
});
export type LootLine = z.infer<typeof lootLineSchema>;
