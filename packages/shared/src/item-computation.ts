import { z } from 'zod';
import { decodedTrackSchema, type DecodedBonuses } from './bonus-decode.js';
import {
  calcularArmadura,
  calcularBlock,
  calcularDanoDeArma,
  calcularValorEfeito,
  calcularValorStat,
  efeitoDoItemSchema,
  INV_SHIELD,
  renderizarTexto,
  resolverTabelaDano,
  resolverVinculo,
  type EfeitoDoItem,
  type LinhaEscala,
} from './item-formula.js';
import { PRIMARY_STATS, primaryStatSchema, type PrimaryStat } from './wow.js';
import {
  bonusTertiarySchema,
  STAT_ID_TERCIARIO,
  wowBondingSchema,
  wowScalingTypeSchema,
  type WowBonding,
} from './wow-bonus.js';

/**
 * O lado do ITEM do payload de tooltip — TIT-136. `DecodedBonuses`
 * (`bonus-decode.ts`) já é o lado dos bônus; falta o que só existe cruzando o
 * item com a escala do ilvl: stats com valor, armadura, dano, `Block`,
 * efeito, conjunto, vínculo.
 *
 * ESTRUTURA, nunca frase pronta — mesma régua do `DecodedBonuses`. A tela
 * monta o texto; o explorador de loot filtra e agrega por modificador.
 */

/* -------------------------------------------------------------------------- */
/* O que o repository lê do Postgres — a forma de leitura, não de escrita     */
/* -------------------------------------------------------------------------- */

/**
 * Uma linha de `WowItemData`, no formato que `computeItemStats` consome.
 * Espelha as colunas da tabela (menos `buildId`/`itemId`, que quem chama já
 * tem) — é o repository quem faz esse `select`.
 */
export const wowItemDataFacetsSchema = z.object({
  itemLevel: z.number().int(),
  quality: z.number().int(),
  inventoryType: z.number().int(),
  material: z.number().int(),
  bonding: z.number().int(),
  flags: z.number().int().array(),
  statIds: z.number().int().array(),
  statAllocs: z.number().int().array(),
  socketAllocs: z.number().int().array(),
  itemDelay: z.number().int().nullable(),
  dmgVariance: z.number().nullable(),
  /** `Description_lang` — o texto em itálico do rodapé do tooltip. Puro
   * passthrough, sem cálculo nenhum, mas mora em `WowItemData` (não no
   * catálogo), então é este módulo quem entrega. */
  flavor: z.string().nullable(),
  itemSetId: z.number().int().nullable(),
  budgetIndex: z.number().int(),
  scalingType: wowScalingTypeSchema,
  armorModifier: z.number().nullable(),
  /**
   * O JSON de `WowItemData.effects`, já validado. `undefined` quando a
   * COLUNA é nula (item sem efeito) — diferente de "não consegui validar",
   * que é responsabilidade de quem monta este objeto tratar como lacuna
   * antes de chegar aqui (nunca deixar um JSON malformado estourar o cálculo
   * do resto do item).
   */
  effects: efeitoDoItemSchema.nullable(),
});
export type WowItemDataFacets = z.infer<typeof wowItemDataFacetsSchema>;

/** Um bônus de conjunto: por spec e por threshold — `ItemSetSpell` cru, sem
 * texto (ver `ComputedItemSet.bonusPorSpec`). */
export const wowItemSetBonusSchema = z.object({
  chrSpecId: z.number().int(),
  threshold: z.number().int(),
  spellId: z.number().int(),
});

/** Uma linha de `WowItemSet`, no formato que `computeItemStats` consome. */
export const wowItemSetFacetsSchema = z.object({
  itemSetId: z.number().int(),
  name: z.string(),
  pieceItemIds: z.number().int().array(),
  bonuses: wowItemSetBonusSchema.array(),
});
export type WowItemSetFacets = z.infer<typeof wowItemSetFacetsSchema>;

/* -------------------------------------------------------------------------- */
/* O payload                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Inclui `agility`/`strength`/`intellect` — **não é só "secundário" no
 * sentido do jogo**. Medido no `Bubblefin Splash Guard` (item catalogado):
 * ele tem o primário fixo Strength (statId 4) E, separadamente, um
 * `intellect` (statId 5) que não é o primário — as duas entradas convivem
 * no `ItemSparse`, sem relação uma com a outra. Se `intellect` não tivesse
 * lugar aqui, o valor sumiria: nem primário (não é o tipo declarado), nem
 * secundário de verdade. Ver `calcularEClassificarStats`.
 */
export const computedStatSecundarioSchema = z.object({
  nome: z.enum([
    'agility',
    'strength',
    'intellect',
    'stamina',
    'crit',
    'haste',
    'versatility',
    'mastery',
  ]),
  valor: z.number().int(),
});
export type ComputedStatSecundario = z.infer<typeof computedStatSecundarioSchema>;

export const computedStatPrimarioSchema = z.object({
  valor: z.number().int(),
  /** Sempre um CONJUNTO — `PrimaryStat` já documenta os quatro casos reais
   * (fixo, restrito, adaptativo). Nunca vazio quando este objeto existe. */
  tipos: primaryStatSchema.array(),
});
export type ComputedStatPrimario = z.infer<typeof computedStatPrimarioSchema>;

export const computedStatTerciarioSchema = z.object({
  tipo: bonusTertiarySchema,
  /**
   * A fórmula sempre calcula um número, pra todo terciário — inclusive
   * `Indestructible` (68 no espécime verificado). Aqui é estrutura, e o
   * valor fica disponível pra quem quiser (filtro, ordenação); quem decide
   * SE a tela imprime o número é `exibeValorDoTerciario()` (`wow-bonus.ts`)
   * — regra em código, não em comentário, porque quem renderiza mora em
   * outro pacote.
   */
  valor: z.number().int(),
});
export type ComputedStatTerciario = z.infer<typeof computedStatTerciarioSchema>;

export const computedDanoDeArmaSchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
  dps: z.number(),
  /** `ItemDelay / 1000`, em segundos — é a "Speed" que o tooltip de arma mostra. */
  velocidade: z.number(),
});
export type ComputedDanoDeArma = z.infer<typeof computedDanoDeArmaSchema>;

export const computedEfeitoSchema = z.object({
  textoRenderizado: z.string(),
  duracaoSegundos: z.number().nullable(),
  maxStacks: z.number().int().nullable(),
});
export type ComputedEfeito = z.infer<typeof computedEfeitoSchema>;

export const computedItemSetSchema = z.object({
  itemSetId: z.number().int(),
  nome: z.string(),
  /**
   * O total de peças do conjunto. **A contagem `(4/5)` não existe sem
   * personagem** — o numerador é omitido de propósito, nunca zero: zero
   * afirmaria "ninguém tem peça nenhuma", que não é o que a lacuna significa.
   */
  pecasTotal: z.number().int(),
  pecaItemIds: z.number().int().array(),
  /**
   * Por spec e threshold, SEM TEXTO — resolver `spellId` em frase exige
   * `Spell.Description_lang`, que não é capturado por peça de conjunto (só
   * pelo efeito on-use/proc do próprio item, em `WowItemData.effects`).
   *
   * Isso não é lacuna: é a decisão já registrada em `docs/db2-do-cliente.md`
   * ("Os números do texto de set ficam para depois") — sem personagem o
   * jogo mostra a linha genérica (`ITEM_SET_BONUS_NO_VALID_SPEC`,
   * "Bonus effects vary based on the player's specialization"), que não
   * depende de nenhum destes ids. Esta lista é estrutura crua pra uma
   * eventual expansão por spec — não é o que o popover padrão usa.
   */
  bonusPorSpec: wowItemSetBonusSchema.array(),
});
export type ComputedItemSet = z.infer<typeof computedItemSetSchema>;

/**
 * Por que o cálculo não pôde completar — nunca um valor aproximado ou o
 * valor base disfarçado de real. Ver "Número errado é pior que número
 * ausente" na TIT-136.
 */
export const ITEM_STATS_INDISPONIVEL = {
  /** `itemString` sem nem o `itemID` — não é peça, é lixo (ver `parseItemString`). */
  ITEM_STRING_INVALIDO: 'item_string_invalido',
  SEM_BUILD_ATIVO: 'sem_build_ativo',
  ITEM_FORA_DO_BUILD: 'item_fora_do_build',
  SEM_ESCALA_PARA_ILVL: 'sem_escala_para_ilvl',
} as const;
export const itemStatsIndisponivelSchema = z.nativeEnum(ITEM_STATS_INDISPONIVEL);
export type ItemStatsIndisponivel = z.infer<typeof itemStatsIndisponivelSchema>;

export const computedItemStatsSchema = z.object({
  /**
   * `null` = a peça não tem primário (trinket que é só efeito), OU o item
   * tem mais de um stat da família primário (fixo + fixo, o caso raro do
   * `Bubblefin Splash Guard`) e não dá pra saber qual é "o" primário sem
   * chutar — ver `computedStatSecundarioSchema`. Nesse caso os dois ainda
   * aparecem em `secundarios`, só não têm a linha de destaque.
   */
  primario: computedStatPrimarioSchema.nullable(),
  secundarios: computedStatSecundarioSchema.array(),
  terciarios: computedStatTerciarioSchema.array(),
  /**
   * O ilvl EFETIVO do drop — `DecodedBonuses.itemLevel` quando algum bônus
   * determina, senão o base do `WowItemData`. `DecodedBonuses.itemLevel`
   * sozinho não basta pro "Item Level 308" do tooltip: ele é nulo sempre
   * que NENHUM bônus mexe em ilvl, que é o caso comum de token e de peça
   * sem upgrade — ver "Item Level da árvore; base do ItemSparse quando ela
   * não dá nada" em `docs/db2-do-cliente.md`.
   */
  itemLevel: z.number().int().positive().nullable(),
  /** `null` = a peça não tem armadura inata (token, joia, arma). */
  armadura: z.number().int().nullable(),
  /** `null` = a peça não é escudo. */
  block: z.number().int().nullable(),
  /** `null` = a peça não é arma. */
  dano: computedDanoDeArmaSchema.nullable(),
  /** `null` = a peça não tem efeito (`Use:`/`Equip:`). */
  efeito: computedEfeitoSchema.nullable(),
  /** `null` = a peça não pertence a conjunto nenhum. */
  set: computedItemSetSchema.nullable(),
  /** `null` = `Bonding` cru fora do que os três estados distinguem — lacuna. */
  vinculo: wowBondingSchema.nullable(),
  /** O texto em itálico do rodapé — puro passthrough de `WowItemData.flavor`. */
  flavor: z.string().nullable(),

  /**
   * Os quatro campos abaixo são PASSTHROUGH de `DecodedBonuses` — não
   * cálculo novo. Moram aqui, e não só no `decoded` interno do
   * `WowItemStatsService`, porque a TIT-135 precisa deles pro tooltip
   * fechar (`Upgrade Level: Myth 4/6`, o descritor `Mythic`) e a única
   * outra forma de obtê-los seria REFAZER a união de bônus — a mesma
   * metade de runtime que este service existe pra encapsular, e onde
   * morava o erro silencioso que custou vinte espécimes de pesquisa. Duas
   * implementações da união são "duas fontes que precisam concordar", e
   * quando divergirem, divergem sem erro. Ver a review da TIT-136.
   */
  /** `null` = sem bônus de track. `scalingId` cru — a regra da season
   * corrente é de quem renderiza, nunca deste objeto. */
  track: decodedTrackSchema.nullable(),
  /** `Mythic`, `Heroic`, `Raid Finder`. `null` em Normal, que não imprime linha. */
  dificuldade: z.string().nullable(),
  /** Quantos bônus de socket apareceram. Zero é o caso comum. */
  sockets: z.number().int().nonnegative(),
  /** Bonus IDs fora do dicionário — campo de PRIMEIRA CLASSE, não sobra. */
  desconhecidos: z.number().int().positive().array(),

  /**
   * `null` = o cálculo completou. Presente = TUDO acima está vazio/nulo por
   * este motivo, não porque a peça realmente não tem stat nenhum.
   */
  indisponivel: itemStatsIndisponivelSchema.nullable(),
});
export type ComputedItemStats = z.infer<typeof computedItemStatsSchema>;

/* -------------------------------------------------------------------------- */
/* O cálculo — função pura: recebe tudo já buscado, nunca toca em banco       */
/* -------------------------------------------------------------------------- */

/**
 * Todo statId "nomeado" que NÃO é o primário flexível — inclui os três
 * fixos (agility/strength/intellect) junto dos cinco secundários de
 * verdade. Ver o comentário de `computedStatSecundarioSchema` pro porquê:
 * um fixo pode aparecer sem ser "o" primário da peça (`Bubblefin Splash
 * Guard`), e sem entrada aqui esse valor desapareceria.
 */
const STAT_ID_NOMEADO: Readonly<Record<number, ComputedStatSecundario['nome']>> = {
  3: 'agility',
  4: 'strength',
  5: 'intellect',
  7: 'stamina',
  32: 'crit',
  36: 'haste',
  40: 'versatility',
  49: 'mastery',
};

const STAT_ID_PRIMARIO_FIXO: Readonly<Record<number, PrimaryStat>> = {
  4: PRIMARY_STATS.STRENGTH,
  3: PRIMARY_STATS.AGILITY,
  5: PRIMARY_STATS.INTELLECT,
};

/** Primário flexível → quais primários a peça pode assumir — ver "Primário
 * flexível: mostrar todos" em `docs/db2-do-cliente.md`. */
const PRIMARIOS_POR_STAT_ID_FLEXIVEL: Readonly<Record<number, PrimaryStat[]>> = {
  71: [PRIMARY_STATS.STRENGTH, PRIMARY_STATS.AGILITY, PRIMARY_STATS.INTELLECT],
  72: [PRIMARY_STATS.STRENGTH, PRIMARY_STATS.AGILITY],
  73: [PRIMARY_STATS.AGILITY, PRIMARY_STATS.INTELLECT],
  74: [PRIMARY_STATS.STRENGTH, PRIMARY_STATS.INTELLECT],
};

/** Um stat, já despareado — item + bônus somam na MESMA entrada quando o
 * statId coincide (ver "Um stat que aparece duas vezes SOMA" na doc). */
function agruparStats(
  item: Pick<WowItemDataFacets, 'statIds' | 'statAllocs' | 'socketAllocs'>,
  statsAdicionados: DecodedBonuses['statsAdicionados'],
): Map<number, { alocacao: number; alocacaoSocket: number }> {
  const agrupado = new Map<number, { alocacao: number; alocacaoSocket: number }>();

  for (let i = 0; i < item.statIds.length; i++) {
    const statId = item.statIds[i]!;
    if (statId < 0) continue; // slot de stat vazio no ItemSparse.
    const atual = agrupado.get(statId) ?? { alocacao: 0, alocacaoSocket: 0 };
    atual.alocacao += item.statAllocs[i] ?? 0;
    atual.alocacaoSocket += item.socketAllocs[i] ?? 0;
    agrupado.set(statId, atual);
  }

  // Os do bônus (Type 2) não têm socket associado — são acréscimo puro.
  for (const { statId, alocacao } of statsAdicionados) {
    if (statId < 0) continue;
    const atual = agrupado.get(statId) ?? { alocacao: 0, alocacaoSocket: 0 };
    atual.alocacao += alocacao;
    agrupado.set(statId, atual);
  }

  return agrupado;
}

interface StatsClassificados {
  primario: ComputedStatPrimario | null;
  secundarios: ComputedStatSecundario[];
  terciarios: ComputedStatTerciario[];
}

function calcularEClassificarStats(
  item: WowItemDataFacets,
  statsAdicionados: DecodedBonuses['statsAdicionados'],
  escala: LinhaEscala,
): StatsClassificados {
  const agrupado = agruparStats(item, statsAdicionados);
  const saida: StatsClassificados = { primario: null, secundarios: [], terciarios: [] };

  // Candidatos a primário FIXO (statId 3/4/5) coletados à parte — só viram
  // `primario` no final, e só quando há exatamente UM. Ver o comentário de
  // `computedItemStatsSchema.primario`.
  const candidatosPrimarioFixo: ComputedStatPrimario[] = [];

  for (const [statId, { alocacao, alocacaoSocket }] of agrupado) {
    const valor = calcularValorStat(
      statId,
      alocacao,
      alocacaoSocket,
      item.budgetIndex,
      item.scalingType,
      escala,
    );

    const flexivel = PRIMARIOS_POR_STAT_ID_FLEXIVEL[statId];
    if (flexivel) {
      saida.primario = { valor, tipos: flexivel };
      continue;
    }

    const nomeNomeado = STAT_ID_NOMEADO[statId];
    if (nomeNomeado) {
      saida.secundarios.push({ nome: nomeNomeado, valor });

      const fixo = STAT_ID_PRIMARIO_FIXO[statId];
      if (fixo) candidatosPrimarioFixo.push({ valor, tipos: [fixo] });
      continue;
    }

    const tipoTerciario = STAT_ID_TERCIARIO[statId];
    if (tipoTerciario) {
      saida.terciarios.push({ tipo: tipoTerciario, valor });
    }

    // statId fora do vocabulário conhecido (nem primário, nomeado ou
    // terciário): mesmo comportamento da auto-conferência — sem linha
    // nomeada pra ele. Não há espécime na fixture que exercite isto.
  }

  // Flexível já preencheu `primario` no laço — não sobrescreve. Sem
  // flexível, só promove o fixo quando é o ÚNICO candidato: com dois (o
  // caso do `Bubblefin Splash Guard`, Strength E Intellect juntos) não dá
  // pra saber qual é "o" primário sem chutar, e os dois já estão em
  // `secundarios` de qualquer forma — nenhum valor se perde.
  if (saida.primario === null && candidatosPrimarioFixo.length === 1) {
    saida.primario = candidatosPrimarioFixo[0]!;
  }

  return saida;
}

function calcularDano(
  item: WowItemDataFacets,
  qualidade: number,
  escala: LinhaEscala,
): ComputedDanoDeArma | null {
  if (item.itemDelay === null || item.dmgVariance === null) return null;

  const tabela = resolverTabelaDano(item.inventoryType, item.flags);
  if (!tabela) return null;

  const dano = calcularDanoDeArma(tabela, qualidade, item.itemDelay, item.dmgVariance, escala);
  return { ...dano, velocidade: item.itemDelay / 1000 };
}

/** O efeito já com os placeholders substituídos — cada `$sN` vira o valor
 * calculado daquele índice de efeito, na mesma escala do ilvl do drop. */
function calcularEfeito(efeito: EfeitoDoItem, escala: LinhaEscala): ComputedEfeito {
  const valoresPorIndice = new Map(
    efeito.efeitos.map((e) => [
      e.effectIndex,
      calcularValorEfeito(e.coefficient, e.scalingClass, escala),
    ]),
  );

  return {
    textoRenderizado: renderizarTexto(efeito, valoresPorIndice),
    duracaoSegundos: efeito.duracaoMs === null ? null : efeito.duracaoMs / 1000,
    maxStacks: efeito.maxStacks,
  };
}

function calcularSet(set: WowItemSetFacets): ComputedItemSet {
  return {
    itemSetId: set.itemSetId,
    nome: set.name,
    pecasTotal: set.pieceItemIds.length,
    pecaItemIds: set.pieceItemIds,
    bonusPorSpec: set.bonuses,
  };
}

/** O que sobrevive numa lacuna, quando já se sabe algo — ver `itemStatsIndisponivel`. */
export interface ConhecidoNaLacuna {
  flavor: string | null;
  itemLevel: number | null;
  track: DecodedBonuses['track'];
  dificuldade: DecodedBonuses['dificuldade'];
  sockets: DecodedBonuses['sockets'];
  desconhecidos: DecodedBonuses['desconhecidos'];
}

const LACUNA_SEM_NADA_CONHECIDO: ConhecidoNaLacuna = {
  flavor: null,
  itemLevel: null,
  track: null,
  dificuldade: null,
  sockets: 0,
  desconhecidos: [],
};

/**
 * A saída para quando o cálculo não pôde rodar — tudo vazio/nulo, com o
 * motivo em `indisponivel`. Exportada porque `WowItemStatsService`
 * (`apps/api`) precisa da MESMA forma pras lacunas que acontecem ANTES de
 * chegar a `computeItemStats` (sem build ativo, item fora do catálogo) —
 * uma só definição do "formato vazio", nunca um objeto montado à mão em
 * cada lugar que precisa dele.
 *
 * Cada campo de `conhecido` sobrevive quando JÁ se sabe alguma coisa —
 * `flavor`/`itemLevel` são passthrough puro de `WowItemData`, os quatro de
 * bônus (`track`/`dificuldade`/`sockets`/`desconhecidos`) são passthrough
 * de `DecodedBonuses` quando os bônus já foram decodificados (o caso de
 * `SEM_ESCALA_PARA_ILVL`: sem escala não sai NÚMERO nenhum, mas o que os
 * bônus já disseram sobre track/dificuldade continua valendo). Omitir
 * qualquer um deles junto com o resto afirmaria uma lacuna que não existe.
 * Nas lacunas ANTERIORES a qualquer leitura (item string inválido, sem
 * build) não há nada disso pra passar, e o padrão vazio é a resposta certa.
 */
export function itemStatsIndisponivel(
  motivo: ItemStatsIndisponivel,
  conhecido: ConhecidoNaLacuna = LACUNA_SEM_NADA_CONHECIDO,
): ComputedItemStats {
  return {
    primario: null,
    secundarios: [],
    terciarios: [],
    itemLevel: conhecido.itemLevel,
    armadura: null,
    block: null,
    dano: null,
    efeito: null,
    set: null,
    vinculo: null,
    flavor: conhecido.flavor,
    track: conhecido.track,
    dificuldade: conhecido.dificuldade,
    sockets: conhecido.sockets,
    desconhecidos: conhecido.desconhecidos,
    indisponivel: motivo,
  };
}

/**
 * O cálculo inteiro — dado o item, os bônus JÁ DECODIFICADOS e a escala do
 * ilvl resolvido, produz o payload. FUNÇÃO PURA: não toca em banco, não
 * resolve build, não busca nada — quem monta esses quatro argumentos é o
 * `WowItemStatsService` (`apps/api`), e é só ele quem sabe o que fazer
 * quando algo está ausente (build inativo, item fora do catálogo).
 *
 * `escala === null` é a ÚNICA lacuna que este módulo precisa saber tratar
 * sozinho: sem ela, NENHUM número sai — é o mesmo cálculo que fecha os 208
 * valores da fixture, e ele precisa da escala inteira pra rodar. As outras
 * lacunas (sem build, item fora do build) o chamador já sabe antes de montar
 * `item`, então nem chegam aqui.
 */
export function computeItemStats(
  item: WowItemDataFacets,
  decoded: DecodedBonuses,
  escala: LinhaEscala | null,
  set: WowItemSetFacets | null,
): ComputedItemStats {
  // Mesma regra do pseudocódigo da TIT-136: o que os bônus determinam vence;
  // sem nenhum bônus de ilvl (o caso comum de token e peça sem upgrade),
  // cai no base do `WowItemData`. `WowItemData.itemLevel` nunca é nulo, então
  // esta linha SEMPRE resolve — a única forma de `itemLevel` sair nulo do
  // payload é a lacuna anterior a `computeItemStats` (sem build, sem item).
  const ilvl = decoded.itemLevel ?? item.itemLevel;

  if (escala === null) {
    return itemStatsIndisponivel(ITEM_STATS_INDISPONIVEL.SEM_ESCALA_PARA_ILVL, {
      flavor: item.flavor,
      itemLevel: ilvl,
      track: decoded.track,
      dificuldade: decoded.dificuldade,
      sockets: decoded.sockets,
      desconhecidos: decoded.desconhecidos,
    });
  }

  const qualidade = decoded.qualidade ?? item.quality;
  const { primario, secundarios, terciarios } = calcularEClassificarStats(
    item,
    decoded.statsAdicionados,
    escala,
  );

  return {
    primario,
    secundarios,
    terciarios,
    itemLevel: ilvl,
    armadura: calcularArmadura(
      item.material,
      item.inventoryType,
      qualidade,
      escala,
      item.armorModifier,
    ),
    block: item.inventoryType === INV_SHIELD ? calcularBlock(qualidade, escala) : null,
    dano: calcularDano(item, qualidade, escala),
    efeito: item.effects === null ? null : calcularEfeito(item.effects, escala),
    set: set === null ? null : calcularSet(set),
    vinculo: resolverVinculo(item.bonding, item.flags, decoded.binding),
    flavor: item.flavor,
    track: decoded.track,
    dificuldade: decoded.dificuldade,
    sockets: decoded.sockets,
    desconhecidos: decoded.desconhecidos,
    indisponivel: null,
  };
}
