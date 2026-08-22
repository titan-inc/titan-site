import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type WowBonding,
  type WowBonusTertiary,
  type WowScalingType,
} from '@prisma/client';
import { COLS_BONUS, COLS_CONTEXT, COLS_ITEM, COLS_SCALING, type BonusFacets } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

const facetasSelect = {
  bonusId: true,
  trackName: true,
  trackRank: true,
  trackMaxRank: true,
  trackScalingId: true,
  itemLevel: true,
  tertiary: true,
  hasSocket: true,
  binding: true,
  difficulty: true,
  difficultyColor: true,
  quality: true,
} as const;

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
      escalas: LinhaEscala[];
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

        return {
          novo: !jaExistia,
          itens: tabelas.itens.length,
          bonuses: tabelas.bonuses.length,
          contextos: tabelas.contextos.length,
          escalas: tabelas.escalas.length,
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
}

/* -------------------------------------------------------------------------- */
/* Colunar → Prisma                                                           */
/* -------------------------------------------------------------------------- */

type LinhaItem = Record<(typeof COLS_ITEM)[number], unknown>;
type LinhaBonus = Record<(typeof COLS_BONUS)[number], unknown>;
type LinhaContexto = Record<(typeof COLS_CONTEXT)[number], unknown>;
type LinhaEscala = Record<(typeof COLS_SCALING)[number], unknown>;

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
    tertiary: linha.tertiary as WowBonusTertiary | null,
    hasSocket: linha.hasSocket as boolean,
    binding: linha.binding as WowBonding | null,
    difficulty: linha.difficulty as string | null,
    difficultyColor: linha.difficultyColor as number | null,
    quality: linha.quality as number | null,
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
  linha: LinhaEscala,
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
