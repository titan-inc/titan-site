import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type WowBonding, type WowItemLevelScaling, type WowScalingType } from '@prisma/client';
import {
  COLS_BONUS,
  COLS_CONTEXT,
  COLS_ITEM,
  COLS_SCALING,
  COLS_SET,
  efeitoDoItemSchema,
  wowItemSetBonusSchema,
  type BonusFacets,
  type LinhaEscala,
  type MultiplicadorPorTipo,
  type WowItemDataFacets,
  type WowItemSetFacets,
} from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

const facetasSelect = {
  bonusId: true,
  trackName: true,
  trackRank: true,
  trackMaxRank: true,
  trackScalingId: true,
  itemLevel: true,
  itemLevelMarcador: true,
  statIds: true,
  statAllocs: true,
  hasSocket: true,
  binding: true,
  difficulty: true,
  difficultyColor: true,
  quality: true,
} as const;

/**
 * As colunas de `WowItemData` que o cálculo de stats usa — comum ao singular
 * (`itemPorId`) e ao plural (`itensPorId`, TIT-135), pra não divergir a lista
 * em dois lugares.
 */
const itemDataSelect = {
  itemLevel: true,
  quality: true,
  inventoryType: true,
  material: true,
  bonding: true,
  flags: true,
  statIds: true,
  statAllocs: true,
  socketAllocs: true,
  itemDelay: true,
  dmgVariance: true,
  flavor: true,
  itemSetId: true,
  budgetIndex: true,
  scalingType: true,
  armorModifier: true,
  effects: true,
} as const;

/**
 * `itemId:itemContext` — a chave de `contextosDeBonusDeVarios` (TIT-135).
 * Exportada para o `WowItemStatsService` montar a mesma chave ao consultar o
 * `Map`, sem duplicar o formato da string nos dois lados.
 */
export function chaveContexto(itemId: number, itemContext: number): string {
  return `${itemId}:${itemContext}`;
}

/**
 * O ÚNICO lugar que lê E ESCREVE as tabelas versionadas por build — TIT-137
 * (leitura) / TIT-140 (carga e ativação).
 *
 * ## Por que "único" é restrição e não organização
 *
 * `WowItemData`, `WowBonus`, `WowItemContextBonus` e `WowItemLevelScaling` têm
 * `buildId` na chave. **Uma consulta que esqueça de filtrar pelo build ativo
 * mistura dois builds e não dá erro nenhum** — é a mesma classe de falha
 * silenciosa que a pesquisa da TIT-136 passou doze rodadas perseguindo.
 *
 * A contenção é não existir outro lugar onde esquecer. A Regra 3 já manda
 * `PrismaClient` só no repository; esta classe estreita isso mais: destas
 * quatro tabelas, só ela lê — e, desde a TIT-140, só ela grava. Quem orquestra
 * a carga é o `WowDataLoaderService`, mas o `$transaction` mora aqui.
 *
 * ## O build vem por parâmetro, nunca é reconsultado aqui
 *
 * Todo método de leitura recebe `buildId` de fora. Se cada método resolvesse o
 * ativo por conta própria, uma troca de build no meio de uma requisição faria
 * a primeira consulta ler um e a segunda ler outro — de novo, sem erro. Quem
 * resolve o ativo é o service, uma vez, e carrega adiante.
 */
@Injectable()
export class WowDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O build que a guilda enxerga, ou `null` se nenhum foi ativado ainda.
   *
   * Nulo é estado legítimo — é como o banco nasce, antes da primeira carga.
   * Quem chama devolve lacuna, nunca estoura: a tela mostrando um buraco é
   * infinitamente melhor que um stack trace na cara do raid leader numa terça.
   */
  async buildAtivo(): Promise<string | null> {
    const linha = await this.prisma.wowDataBuild.findFirst({
      where: { active: true },
      select: { buildId: true },
    });
    return linha?.buildId ?? null;
  }

  /**
   * As facetas destes bonus ids, no build dado. O que não existir simplesmente
   * não volta — ausente é DESCONHECIDO, nunca uma linha de nulos.
   */
  async facetasDeBonus(buildId: string, bonusIds: number[]): Promise<BonusFacets[]> {
    if (bonusIds.length === 0) return [];

    return this.prisma.wowBonus.findMany({
      where: { buildId, bonusId: { in: bonusIds } },
      select: facetasSelect,
    });
  }

  /**
   * A metade da união que só existe fora do `itemString` — TIT-136. Os
   * bônus que a árvore aplica para ESTE item, NESTE `itemContext` — quem
   * chama faz `bonusIds ∪ isto` antes de buscar as facetas. Ver
   * "O `itemString` NÃO é a fonte completa" em `docs/db2-do-cliente.md`.
   */
  async contextosDeBonus(buildId: string, itemId: number, itemContext: number): Promise<number[]> {
    const linhas = await this.prisma.wowItemContextBonus.findMany({
      where: { buildId, itemId, itemContext },
      select: { bonusId: true },
    });
    return linhas.map((l) => l.bonusId);
  }

  /**
   * A mesma consulta que `contextosDeBonus`, para VÁRIOS pares (`itemId`,
   * `itemContext`) de uma vez — a onda 1 de `calcularVarios` (TIT-135). Uma
   * página de histórico não pode virar uma consulta de árvore por linha.
   *
   * A chave do `Map` é `chaveContexto(itemId, itemContext)` — quem chama
   * despareia por ela, nunca reconstrói a string à mão.
   */
  async contextosDeBonusDeVarios(
    buildId: string,
    pares: Array<{ itemId: number; itemContext: number }>,
  ): Promise<Map<string, number[]>> {
    const porChave = new Map<string, number[]>();
    if (pares.length === 0) return porChave;

    // Sem duplicata no `OR`: o mesmo par se repete entre itemStrings
    // diferentes do mesmo item (mesmo contexto, bônus explícitos distintos).
    const paresUnicos = [
      ...new Map(pares.map((p) => [chaveContexto(p.itemId, p.itemContext), p])).values(),
    ];

    const linhas = await this.prisma.wowItemContextBonus.findMany({
      where: {
        buildId,
        OR: paresUnicos.map((p) => ({ itemId: p.itemId, itemContext: p.itemContext })),
      },
      select: { itemId: true, itemContext: true, bonusId: true },
    });

    for (const linha of linhas) {
      const chave = chaveContexto(linha.itemId, linha.itemContext);
      const atual = porChave.get(chave) ?? [];
      atual.push(linha.bonusId);
      porChave.set(chave, atual);
    }
    return porChave;
  }

  /**
   * A linha de `WowItemData` de um item, no build dado — o lado do ITEM do
   * cálculo de stats (TIT-136), companheiro de `facetasDeBonus` (o lado dos
   * bônus). `null` quando o item não tem dado neste build: patch que
   * removeu o item, ou catálogo na frente do build carregado — mesma lacuna
   * que `idsDeItemNoBuild` já relata em agregado.
   */
  async itemPorId(buildId: string, itemId: number): Promise<WowItemDataFacets | null> {
    const linha = await this.prisma.wowItemData.findUnique({
      where: { buildId_itemId: { buildId, itemId } },
      select: itemDataSelect,
    });
    if (!linha) return null;

    return { ...linha, effects: paraEfeitoDoItem(itemId, linha.effects) };
  }

  /**
   * A mesma leitura que `itemPorId`, para VÁRIOS `itemId` de uma vez — a
   * onda 1 de `calcularVarios` (TIT-135). `itemId` sai do `select` e vira a
   * chave do `Map`, pra `WowItemDataFacets` não carregar um campo que o
   * schema não declara.
   */
  async itensPorId(buildId: string, itemIds: number[]): Promise<Map<number, WowItemDataFacets>> {
    if (itemIds.length === 0) return new Map();

    const linhas = await this.prisma.wowItemData.findMany({
      where: { buildId, itemId: { in: itemIds } },
      select: { itemId: true, ...itemDataSelect },
    });

    return new Map(
      linhas.map(({ itemId, ...resto }) => [
        itemId,
        { ...resto, effects: paraEfeitoDoItem(itemId, resto.effects) },
      ]),
    );
  }

  /**
   * A linha de `WowItemLevelScaling` para este ilvl, no build dado. `null`
   * quando o ilvl resolvido não tem linha — ilvl fora da faixa que o dump
   * cobriu, lacuna e não zero (Regra 7).
   */
  async escalaPorItemLevel(buildId: string, itemLevel: number): Promise<LinhaEscala | null> {
    const linha = await this.prisma.wowItemLevelScaling.findUnique({
      where: { buildId_itemLevel: { buildId, itemLevel } },
    });
    if (!linha) return null;

    return paraLinhaEscala(linha);
  }

  /**
   * A mesma leitura que `escalaPorItemLevel`, para VÁRIOS `itemLevel` de uma
   * vez — a onda 2 de `calcularVarios` (TIT-135), depois que a onda 1 já
   * decodificou os bônus e sabe o ilvl efetivo de cada item.
   */
  async escalasPorItemLevel(
    buildId: string,
    itemLevels: number[],
  ): Promise<Map<number, LinhaEscala>> {
    if (itemLevels.length === 0) return new Map();

    const linhas = await this.prisma.wowItemLevelScaling.findMany({
      where: { buildId, itemLevel: { in: itemLevels } },
    });

    return new Map(linhas.map((linha) => [linha.itemLevel, paraLinhaEscala(linha)]));
  }

  /** O conjunto (`WowItemSet`) que `WowItemData.itemSetId` aponta, no build dado. */
  async setPorId(buildId: string, itemSetId: number): Promise<WowItemSetFacets | null> {
    const linha = await this.prisma.wowItemSet.findUnique({
      where: { buildId_itemSetId: { buildId, itemSetId } },
      select: { itemSetId: true, name: true, pieceItemIds: true, bonuses: true },
    });
    if (!linha) return null;

    return { ...linha, bonuses: paraBonusesDoSet(itemSetId, linha.bonuses) };
  }

  /**
   * A mesma leitura que `setPorId`, para VÁRIOS `itemSetId` de uma vez — a
   * onda 2 de `calcularVarios` (TIT-135), pelos `itemSetId` que a onda 1 já
   * trouxe junto de cada `WowItemData`.
   */
  async setsPorId(buildId: string, itemSetIds: number[]): Promise<Map<number, WowItemSetFacets>> {
    if (itemSetIds.length === 0) return new Map();

    const linhas = await this.prisma.wowItemSet.findMany({
      where: { buildId, itemSetId: { in: itemSetIds } },
      select: { itemSetId: true, name: true, pieceItemIds: true, bonuses: true },
    });

    return new Map(
      linhas.map((linha) => [
        linha.itemSetId,
        { ...linha, bonuses: paraBonusesDoSet(linha.itemSetId, linha.bonuses) },
      ]),
    );
  }

  /**
   * `MAX(WowBonus.trackScalingId)` do build — a season de track mais recente
   * que ele conhece (TIT-135). Serve só para quem RENDERIZA decidir se a
   * contagem `4/6` aparece, comparando com `DecodedTrack.scalingId`; este
   * método não faz a comparação, só entrega o número — uma consulta por
   * build, derivada, cacheável pelo chamador se precisar.
   *
   * `null` quando o build não tem nenhum bonus com track — não há season
   * para comparar.
   */
  async trackScalingIdAtual(buildId: string): Promise<number | null> {
    const resultado = await this.prisma.wowBonus.aggregate({
      where: { buildId },
      _max: { trackScalingId: true },
    });
    return resultado._max.trackScalingId;
  }

  /** Todo bonus id que este build conhece — para o relatório de desconhecidos. */
  async idsDeBonusConhecidos(buildId: string): Promise<Set<number>> {
    const linhas = await this.prisma.wowBonus.findMany({
      where: { buildId },
      select: { bonusId: true },
    });
    return new Set(linhas.map((l) => l.bonusId));
  }

  /**
   * Todo `itemId` com `WowItemData` gravado neste build — para o relatório
   * responder "item no catálogo sem dado no build" (TIT-140/TIT-136).
   */
  async idsDeItemNoBuild(buildId: string): Promise<Set<number>> {
    const linhas = await this.prisma.wowItemData.findMany({
      where: { buildId },
      select: { itemId: true },
    });
    return new Set(linhas.map((l) => l.itemId));
  }

  /** Se existe uma linha de `WowDataBuild` com este id — carregada ou não. */
  async buildExiste(buildId: string): Promise<boolean> {
    const linha = await this.prisma.wowDataBuild.findUnique({
      where: { buildId },
      select: { buildId: true },
    });
    return linha !== null;
  }

  /**
   * Grava um build inteiro — TIT-140. **Nunca ativa**: `active` só é tocado
   * por `ativarBuild()`, que é a rota própria.
   *
   * Recarregar o MESMO build apaga as linhas dele e regrava do zero, nunca
   * faz merge — é o que garante que uma correção substitui o build inteiro em
   * vez de deixar linha velha misturada com a nova.
   *
   * Uma única transação interativa: se qualquer lote falhar no meio, nada
   * fica gravado. O timeout default do Prisma (5s) não alcança ~175 mil
   * linhas, por isso o `timeout` explícito.
   */
  async regravarBuild(
    buildId: string,
    tabelas: {
      itens: LinhaItem[];
      bonuses: LinhaBonus[];
      contextos: LinhaContexto[];
      escalas: LinhaEscalaColunar[];
      sets: LinhaSet[];
    },
  ): Promise<ContagemDeLinhasGravadas> {
    return this.prisma.$transaction(
      async (tx) => {
        const jaExistia =
          (await tx.wowDataBuild.findUnique({
            where: { buildId },
            select: { buildId: true },
          })) !== null;

        // `active` não entra em `create` nem `update` — carregar não é ativar.
        await tx.wowDataBuild.upsert({
          where: { buildId },
          create: { buildId },
          update: {},
        });

        // Regrava do zero: recarregar o MESMO build tem que produzir o build
        // inteiro de novo, nunca um merge com o que já estava lá.
        await tx.wowItemData.deleteMany({ where: { buildId } });
        await tx.wowBonus.deleteMany({ where: { buildId } });
        await tx.wowItemContextBonus.deleteMany({ where: { buildId } });
        await tx.wowItemLevelScaling.deleteMany({ where: { buildId } });
        await tx.wowItemSet.deleteMany({ where: { buildId } });

        await emLotes(tabelas.itens, COLS_ITEM.length, (lote) =>
          tx.wowItemData.createMany({ data: lote.map((linha) => paraItemData(buildId, linha)) }),
        );
        await emLotes(tabelas.bonuses, COLS_BONUS.length, (lote) =>
          tx.wowBonus.createMany({ data: lote.map((linha) => paraBonus(buildId, linha)) }),
        );
        await emLotes(tabelas.contextos, COLS_CONTEXT.length, (lote) =>
          tx.wowItemContextBonus.createMany({
            data: lote.map((linha) => paraContexto(buildId, linha)),
          }),
        );
        await emLotes(tabelas.escalas, COLS_SCALING.length, (lote) =>
          tx.wowItemLevelScaling.createMany({
            data: lote.map((linha) => paraEscala(buildId, linha)),
          }),
        );

        await emLotes(tabelas.sets, COLS_SET.length, (lote) =>
          tx.wowItemSet.createMany({ data: lote.map((linha) => paraSet(buildId, linha)) }),
        );

        return {
          novo: !jaExistia,
          itens: tabelas.itens.length,
          bonuses: tabelas.bonuses.length,
          contextos: tabelas.contextos.length,
          escalas: tabelas.escalas.length,
          sets: tabelas.sets.length,
        };
      },
      { timeout: 120_000 },
    );
  }

  /**
   * TROCA, nunca `UPDATE` solto — provado contra Postgres real: o índice
   * parcial único (`WowDataBuild_um_ativo_so`) recusa um segundo
   * `active = true`, e desativar/ativar em dois comandos separados abriria
   * uma janela com ZERO builds ativos. As duas `UPDATE` na MESMA transação.
   *
   * Não confere se `buildId` existe — quem chama (`WowDataLoaderService`)
   * confere antes, para devolver um erro que nomeia o build errado em vez de
   * um "0 linhas afetadas" silencioso.
   */
  async ativarBuild(buildId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.wowDataBuild.updateMany({ where: { active: true }, data: { active: false } }),
      this.prisma.wowDataBuild.update({ where: { buildId }, data: { active: true } }),
    ]);
  }
}

export interface ContagemDeLinhasGravadas {
  /** `false` quando o build já existia — é o caso de recarregar. */
  novo: boolean;
  itens: number;
  bonuses: number;
  contextos: number;
  escalas: number;
  sets: number;
}

/* -------------------------------------------------------------------------- */
/* Prisma → forma de leitura do shared                                        */
/* -------------------------------------------------------------------------- */

const logger = new Logger('WowDataRepository');

/** `Float[4]`, na ordem armor/weapon/trinket/jewelry — o inverso de
 * `multiplicadorComoArray()` no gerador (`scripts/db2/montar-escalas.ts`). */
function paraMultiplicador(bruto: number[]): MultiplicadorPorTipo {
  return {
    armor: bruto[0] ?? 0,
    weapon: bruto[1] ?? 0,
    trinket: bruto[2] ?? 0,
    jewelry: bruto[3] ?? 0,
  };
}

/** `WowItemLevelScaling` (linha crua do Prisma) → `LinhaEscala` — comum ao
 * singular (`escalaPorItemLevel`) e ao plural (`escalasPorItemLevel`). */
function paraLinhaEscala(linha: WowItemLevelScaling): LinhaEscala {
  return {
    itemLevel: linha.itemLevel,
    budget: linha.budget,
    damageReplaceStat: linha.damageReplaceStat,
    damageSecondary: linha.damageSecondary,
    crMult: paraMultiplicador(linha.crMult),
    stamMult: paraMultiplicador(linha.stamMult),
    socketCost: linha.socketCost,
    armorTotal: linha.armorTotal,
    armorQuality: linha.armorQuality,
    armorShield: linha.armorShield,
    dmgOneHand: linha.dmgOneHand,
    dmgTwoHand: linha.dmgTwoHand,
    dmgOneHandCaster: linha.dmgOneHandCaster,
    dmgTwoHandCaster: linha.dmgTwoHandCaster,
  };
}

/**
 * O JSON de `WowItemData.effects`, validado contra o formato que o próprio
 * gerador emite. JSON malformado vira `null` (o item perde só o efeito, não
 * o resto do cálculo) — nunca estoura a requisição por causa de UM campo
 * particular de UM item. Nenhum espécime da fixture exercita isto: é rede de
 * segurança, não caminho esperado, por isso o log em vez de silêncio total.
 */
function paraEfeitoDoItem(itemId: number, bruto: Prisma.JsonValue): WowItemDataFacets['effects'] {
  if (bruto === null) return null;

  const validado = efeitoDoItemSchema.safeParse(bruto);
  if (!validado.success) {
    logger.warn(
      `WowItemData.effects do item ${itemId} não bate com o formato esperado — tratado como ausente.`,
    );
    return null;
  }
  return validado.data;
}

/** Mesma régua de `paraEfeitoDoItem`: um conjunto com `bonuses` malformado
 * perde só os bônus, não o nome nem a contagem de peças. */
function paraBonusesDoSet(itemSetId: number, bruto: Prisma.JsonValue): WowItemSetFacets['bonuses'] {
  const validado = wowItemSetBonusSchema.array().safeParse(bruto);
  if (!validado.success) {
    logger.warn(
      `WowItemSet.bonuses do conjunto ${itemSetId} não bate com o formato esperado — tratado como vazio.`,
    );
    return [];
  }
  return validado.data;
}

/* -------------------------------------------------------------------------- */
/* Colunar → Prisma                                                           */
/* -------------------------------------------------------------------------- */

type LinhaItem = Record<(typeof COLS_ITEM)[number], unknown>;
type LinhaSet = Record<(typeof COLS_SET)[number], unknown>;
type LinhaBonus = Record<(typeof COLS_BONUS)[number], unknown>;
type LinhaContexto = Record<(typeof COLS_CONTEXT)[number], unknown>;
type LinhaEscalaColunar = Record<(typeof COLS_SCALING)[number], unknown>;

/**
 * `createMany` em lotes — o protocolo do Postgres aceita no máximo **65.535**
 * parâmetros por statement. `contextos` sozinho é 163.207 linhas × (3 colunas
 * + `buildId` injetado) = **652 mil parâmetros**; sem isso a carga estoura
 * antes de tocar o banco. `colunasPorLinha` inclui o `buildId` — quem chama
 * passa `COLS_X.length`, e o `+1` do `buildId` é somado aqui, uma vez só.
 */
async function emLotes<L>(
  linhas: L[],
  colunasPorLinha: number,
  gravar: (lote: L[]) => Promise<unknown>,
): Promise<void> {
  const tamanhoDoLote = Math.floor(65_535 / (colunasPorLinha + 1));
  for (let i = 0; i < linhas.length; i += tamanhoDoLote) {
    await gravar(linhas.slice(i, i + tamanhoDoLote));
  }
}

/** `null` de JSON no arquivo vira o marcador que o Prisma exige para JSON nulo. */
function paraJson(valor: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return valor === null ? Prisma.JsonNull : (valor as Prisma.InputJsonValue);
}

function paraItemData(buildId: string, linha: LinhaItem): Prisma.WowItemDataCreateManyInput {
  return {
    buildId,
    itemId: linha.itemId as number,
    itemLevel: linha.itemLevel as number,
    quality: linha.quality as number,
    inventoryType: linha.inventoryType as number,
    material: linha.material as number,
    bonding: linha.bonding as number,
    flags: linha.flags as number[],
    statIds: linha.statIds as number[],
    statAllocs: linha.statAllocs as number[],
    socketAllocs: linha.socketAllocs as number[],
    itemDelay: linha.itemDelay as number | null,
    dmgVariance: linha.dmgVariance as number | null,
    flavor: linha.flavor as string | null,
    nameDescriptionId: linha.nameDescriptionId as number | null,
    itemSetId: linha.itemSetId as number | null,
    budgetIndex: linha.budgetIndex as number,
    scalingType: linha.scalingType as WowScalingType,
    armorModifier: linha.armorModifier as number | null,
    effects: paraJson(linha.effects),
  };
}

function paraBonus(buildId: string, linha: LinhaBonus): Prisma.WowBonusCreateManyInput {
  return {
    buildId,
    bonusId: linha.bonusId as number,
    trackName: linha.trackName as string | null,
    trackRank: linha.trackRank as number | null,
    trackMaxRank: linha.trackMaxRank as number | null,
    trackScalingId: linha.trackScalingId as number | null,
    itemLevel: linha.itemLevel as number | null,
    itemLevelMarcador: linha.itemLevelMarcador as number | null,
    statIds: linha.statIds as number[],
    statAllocs: linha.statAllocs as number[],
    hasSocket: linha.hasSocket as boolean,
    binding: linha.binding as WowBonding | null,
    difficulty: linha.difficulty as string | null,
    difficultyColor: linha.difficultyColor as number | null,
    quality: linha.quality as number | null,
  };
}

function paraSet(buildId: string, linha: LinhaSet): Prisma.WowItemSetCreateManyInput {
  return {
    buildId,
    itemSetId: linha.itemSetId as number,
    name: linha.name as string,
    pieceItemIds: linha.pieceItemIds as number[],
    // `bonuses` é NOT NULL: set sem bônus é lista vazia, nunca ausência —
    // conjunto existe mesmo antes de a Blizzard publicar os efeitos dele.
    bonuses: linha.bonuses ?? [],
  };
}

function paraContexto(
  buildId: string,
  linha: LinhaContexto,
): Prisma.WowItemContextBonusCreateManyInput {
  return {
    buildId,
    itemId: linha.itemId as number,
    itemContext: linha.itemContext as number,
    bonusId: linha.bonusId as number,
  };
}

function paraEscala(
  buildId: string,
  linha: LinhaEscalaColunar,
): Prisma.WowItemLevelScalingCreateManyInput {
  return {
    buildId,
    itemLevel: linha.itemLevel as number,
    budget: linha.budget as number[],
    damageReplaceStat: linha.damageReplaceStat as number,
    damageSecondary: linha.damageSecondary as number,
    crMult: linha.crMult as number[],
    stamMult: linha.stamMult as number[],
    socketCost: linha.socketCost as number,
    armorTotal: linha.armorTotal as number[],
    armorQuality: linha.armorQuality as number[],
    armorShield: linha.armorShield as number[],
    dmgOneHand: linha.dmgOneHand as number[],
    dmgTwoHand: linha.dmgTwoHand as number[],
    dmgOneHandCaster: linha.dmgOneHandCaster as number[],
    dmgTwoHandCaster: linha.dmgTwoHandCaster as number[],
  };
}
