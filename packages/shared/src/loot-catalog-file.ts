import { z } from 'zod';
import { primaryStatSchema, raidDifficultyLevelSchema, wowSpecSchema } from './wow.js';

/**
 * O arquivo de catálogo: uma raid, seus bosses e o que cada um solta.
 *
 * É a entrada do carregador e a saída do gerador. Fica versionado no
 * repositório, então é revisável em PR e tem histórico por season — não é dado
 * de jogador, e por isso não cai na restrição de não versionar dado pessoal.
 *
 * **O arquivo é a fonte da verdade.** Drop que sumiu dele é removido do banco.
 * Isso é seguro porque histórico e sessão guardam `itemId`, nunca a linha de
 * drop: editar o catálogo não corrompe o que já aconteceu.
 */

/**
 * Item do arquivo.
 *
 * Só o `itemId` é obrigatório. Todo o resto é opcional porque o arquivo pode
 * nascer de três jeitos — gerado com tudo preenchido, digitado à mão com o
 * mínimo, ou uma mistura — e o carregador precisa aceitar os três.
 *
 * Campo ausente significa **"não mexi nisso"**, nunca "apague o que está lá".
 * A distinção importa: o banco pode ter enriquecimento vindo da API e specs
 * curadas por um humano, e recarregar o arquivo não pode destruir nenhum dos
 * dois.
 */
export const catalogFileItemSchema = z.object({
  itemId: z.number().int().positive(),

  name: z.string().optional(),
  icon: z.string().optional(),

  /**
   * Slot na grafia da API REST: `TRINKET`, `HEAD`, `WEAPON`.
   *
   * Preenchendo à mão, cuidado: a API Lua do cliente e o export do
   * RCLootCouncil escrevem o mesmo slot como `INVTYPE_TRINKET`. As duas grafias
   * não casam, e nada acusa — só deixa de encontrar.
   */
  equipLoc: z.string().optional(),

  itemSubclass: z.string().optional(),
  primaryStats: primaryStatSchema.array().optional(),

  /**
   * Quais specs podem usar — ver TIT-77.
   *
   * Lista vazia e campo ausente são a mesma coisa aqui: "não decidi". Para
   * dizer "ninguém usa" é preciso marcar no banco, porque um arquivo gerado
   * automaticamente vem com isto vazio e não pode ser lido como decisão.
   *
   * Quem preencheu isto muda o que o carregador faz — ver `specsFromClient`.
   */
  usableBySpecs: wowSpecSchema.array().optional(),

  /**
   * `usableBySpecs` acima é PROPOSTA da máquina, não curadoria humana.
   *
   * O dump do Encounter Journal traz quais specs o cliente mostra para cada
   * peça, e o filtro dele é bom — sabe que Holy Paladin pode rolar num trinket
   * de healer e que Frost Mage não, mesmo os dois sendo intelecto. Mas continua
   * respondendo "quem pode equipar e aproveita", que não é a mesma pergunta que
   * "a guilda deixa rolar" — essa é política de guilda.
   *
   * A marcação existe porque `specsCuratedAt` no banco significa **um humano
   * olhou**, e o carregador o preenche sempre que recebe specs. Sem distinguir a
   * origem, o arquivo gerado passaria a afirmar revisão que ninguém fez, e
   * regerar a raid depois de um hotfix sobrescreveria curadoria de verdade.
   *
   * Então com esta marca o carregador grava as specs **sem** tocar em
   * `specsCuratedAt`, e **pula** o item que já tem curadoria. Curadoria
   * substitui derivação; derivação nunca substitui curadoria.
   *
   * Quem edita o arquivo à mão remove a marca — é isso que diz "agora sou eu
   * assinando".
   */
  specsFromClient: z.boolean().optional(),

  /**
   * Dificuldades em que ESTE item cai, quando diferem das do boss.
   *
   * Existe como escape: o journal da Blizzard dá uma lista de itens e um
   * conjunto de dificuldades, sem dizer quais itens existem em quais — então o
   * gerador produz o produto cartesiano. Quando alguém descobrir que uma peça é
   * exclusiva de mítico, é aqui que a exceção é registrada.
   */
  difficulties: raidDifficultyLevelSchema.array().nonempty().optional(),
});
export type CatalogFileItem = z.infer<typeof catalogFileItemSchema>;

export const catalogFileBossSchema = z.object({
  name: z.string().min(1),

  /** Ordem em que se mata. Também é a chave que casa o boss numa recarga. */
  position: z.number().int().nonnegative(),

  /**
   * `dungeonEncounterID` do jogo — o mesmo id que o Warcraft Logs usa.
   *
   * Opcional para o arquivo poder ser escrito antes de alguém buscar o número,
   * mas boss sem ele **não casa com a colagem do addon**. O carregador avisa.
   */
  dungeonEncounterId: z.number().int().positive().optional(),

  /** Dificuldades em que o boss existe. Vale para todos os itens dele. */
  difficulties: raidDifficultyLevelSchema.array().nonempty(),

  items: catalogFileItemSchema.array(),
});
export type CatalogFileBoss = z.infer<typeof catalogFileBossSchema>;

export const catalogFileSchema = z.object({
  /**
   * Versão do formato do arquivo.
   *
   * Existe para o carregador recusar o que não conhece em vez de adivinhar —
   * mesmo princípio do cabeçalho `TILC/1` da colagem do addon.
   */
  version: z.literal(1),

  /** Identidade estável da raid. É por ele que a recarga acha o que atualizar. */
  slug: z.string().min(1),
  name: z.string().min(1),

  /**
   * De qual instância do Encounter Journal este arquivo foi gerado.
   *
   * É **procedência**, não dado da raid: serve para regerar o arquivo depois de
   * um hotfix mexer na loot table, sem redescobrir o número entre as 210
   * instâncias do índice, procurando por nome.
   *
   * Fica no arquivo e **não** no banco de propósito. Chegou a ser cogitado
   * persistir este id e o `journalEncounterId` de cada boss, e foi descartado: o
   * casamento nunca foi por eles — o gerador usa o dump do cliente e o carregador
   * casa boss por `raidId + position` — então virariam coluna sem leitor. E a
   * Regra 7 manda gravar antes de exibir porque semana não gravada não volta;
   * estes ids estão na API da Blizzard para sempre, então não são perecíveis.
   */
  journalInstanceId: z.number().int().positive().optional(),

  /**
   * Season da Blizzard, ou ausente.
   *
   * Ausente é o estado normal de raid cadastrada antes da season começar: a
   * `GameSeason` só existe depois que ela começa de verdade.
   */
  seasonId: z.number().int().optional(),

  /**
   * `instanceMapID` do cliente, o mesmo que o addon emite no cabeçalho.
   *
   * NÃO é a zona do Warcraft Logs. Aberrus é `2569` aqui e zona `33` lá.
   */
  instanceMapId: z.number().int().positive().optional(),

  bosses: catalogFileBossSchema.array().nonempty(),
});
export type CatalogFile = z.infer<typeof catalogFileSchema>;
