import { Injectable, Logger } from '@nestjs/common';
import {
  toEncounterMatchKey,
  type CatalogFile,
  type CatalogFileBoss,
  type LootCatalogRaid,
  type LootCatalogRaidSummary,
  type RaidDifficultyLevel,
  type WowItem,
} from '@titan/shared';
import { WarcraftLogsService } from '../warcraftlogs/warcraftlogs.service';
import { LootCatalogRepository, type RaidFilter } from './loot-catalog.repository';
import { SPEC_FROM_DB } from './spec-map';

/** O que a carga fez, para o comando conseguir relatar. */
export interface ResultadoDaCarga {
  raid: string;
  bosses: number;
  drops: number;
  itens: number;
  semDungeonEncounterId: string[];
}

export interface OpcoesDaCarga {
  /**
   * Pula a conferência dos ids contra o Warcraft Logs.
   *
   * Existe para o WCL fora do ar não impedir uma carga. É saída de emergência,
   * não o caminho normal — sem a conferência, id errado volta a ser falha
   * silenciosa.
   */
  semConferencia?: boolean;
}

/** O que o repository devolve, antes de virar o contrato do shared. */
type RaidRow = Awaited<ReturnType<LootCatalogRepository['findRaids']>>[number];
type ItemRow = RaidRow['encounters'][number]['drops'][number]['item'];

/**
 * Leitura do catálogo de loot.
 *
 * O catálogo é lookup, não fonte da verdade do que aconteceu: a linha de loot e
 * a sessão ao vivo guardam `itemId`, nunca a linha de drop. É isso que faz
 * editar o catálogo — corrigir uma loot table, arquivar uma raid — nunca
 * corromper histórico já gravado.
 */
@Injectable()
export class LootCatalogService {
  private readonly logger = new Logger(LootCatalogService.name);

  constructor(
    private readonly repo: LootCatalogRepository,
    private readonly wcl: WarcraftLogsService,
  ) {}

  async listRaids(filtro: RaidFilter = {}): Promise<LootCatalogRaid[]> {
    const raids = await this.repo.findRaids(filtro);
    return raids.map(toLootCatalogRaid);
  }

  /**
   * As raids sem os drops, que é o que a lista precisa.
   *
   * A resposta completa repete o item em cada dificuldade: as quatro raids do
   * tier corrente dão 468 drops, que no endpoint são **306 KB** contra **553
   * bytes** do resumo. Quem precisa dos drops quer **uma** raid.
   */
  async listRaidSummaries(filtro: RaidFilter = {}): Promise<LootCatalogRaidSummary[]> {
    const raids = await this.repo.findRaidSummaries(filtro);

    return raids.map(({ _count, ...raid }) => ({ ...raid, encounterCount: _count.encounters }));
  }

  async getRaid(slug: string, difficulty?: RaidDifficultyLevel): Promise<LootCatalogRaid | null> {
    const raid = await this.repo.findRaidBySlug(slug, difficulty);
    return raid ? toLootCatalogRaid(raid) : null;
  }

  /**
   * Todo `itemId` cadastrado — para a rota de ops que filtra o `ItemSparse.db2`
   * pelos itens que interessam (TIT-136).
   */
  listarItemIdsCatalogados(): Promise<number[]> {
    return this.repo.findAllItemIds();
  }

  /**
   * Aplica um arquivo de catálogo ao banco.
   *
   * Orquestra em três tempos: confere, grava, relata. A conferência vem antes de
   * qualquer escrita de propósito — carga que grava metade e para deixa o
   * catálogo num estado que ninguém pediu.
   */
  async carregarArquivo(
    arquivo: CatalogFile,
    opcoes: OpcoesDaCarga = {},
  ): Promise<ResultadoDaCarga> {
    if (!opcoes.semConferencia) {
      await this.conferirIdsContraWcl(arquivo);
    }

    const { id: raidId } = await this.repo.upsertRaid({
      slug: arquivo.slug,
      name: arquivo.name,
      seasonId: arquivo.seasonId,
      instanceMapId: arquivo.instanceMapId,
    });

    let drops = 0;
    const itens = new Set<number>();

    for (const boss of arquivo.bosses) {
      const { id: encounterId } = await this.repo.upsertEncounter({
        raidId,
        name: boss.name,
        position: boss.position,
        dungeonEncounterId: boss.dungeonEncounterId,
      });

      for (const item of boss.items) {
        // Campo por campo, e não `upsertItem(item)`: o item do ARQUIVO tem
        // `difficulties`, que é do drop e não do dicionário, e o repositório
        // espalha o que recebe nas colunas do Prisma. Repassar o objeto inteiro
        // quebra no dia em que alguém usar o escape de dificuldade por item —
        // que é justamente o campo que quase nunca aparece, então quebraria
        // tarde e longe daqui.
        await this.repo.upsertItem({
          itemId: item.itemId,
          name: item.name,
          icon: item.icon,
          equipLoc: item.equipLoc,
          itemSubclass: item.itemSubclass,
          primaryStats: item.primaryStats,
          usableBySpecs: item.usableBySpecs,
          specsFromClient: item.specsFromClient,
        });
        itens.add(item.itemId);
      }

      const doBoss = dropsDoBoss(boss);
      await this.repo.replaceDrops(encounterId, doBoss);
      drops += doBoss.length;
    }

    return {
      raid: arquivo.slug,
      bosses: arquivo.bosses.length,
      drops,
      itens: itens.size,
      semDungeonEncounterId: arquivo.bosses
        .filter((b) => b.dungeonEncounterId === undefined)
        .map((b) => b.name),
    };
  }

  /**
   * Pergunta ao Warcraft Logs o nome de cada boss e compara com o arquivo.
   *
   * O `dungeonEncounterId` é a chave que casa a colagem do addon com o boss. Se
   * ele estiver errado, nada quebra na carga — o sintoma aparece semanas depois,
   * como "a colagem não casa com boss nenhum", no meio de uma raid.
   *
   * Como o WCL responde nome a partir do mesmo id que o jogo usa, dá para
   * transformar isso num erro detectável. Verificado com sete ids reais de duas
   * expansões, todos batendo — ver TIT-46.
   *
   * A comparação é por `toEncounterMatchKey()`, nunca por igualdade literal: as
   * duas fontes pontuam o mesmo boss de formas diferentes, e em 09/08/2026 uma
   * vírgula reprovou a carga de The Dreamrift com um id **correto**, vindo do
   * cliente do WoW. Colapsar pontuação não afrouxa a verificação — id apontando
   * para outro boss continua barrado, porque nomes diferentes de verdade não
   * colidem sob normalização nenhuma.
   */
  private async conferirIdsContraWcl(arquivo: CatalogFile): Promise<void> {
    const comId = arquivo.bosses.filter((b) => b.dungeonEncounterId !== undefined);
    if (comId.length === 0) return;

    const catalogoWcl = await this.wcl.getRaidCatalog();
    const divergencias: string[] = [];

    for (const boss of comId) {
      const noWcl = catalogoWcl.encounters.get(boss.dungeonEncounterId as number);

      if (!noWcl) {
        divergencias.push(`${boss.name}: o WCL não conhece o encounter ${boss.dungeonEncounterId}`);
      } else if (toEncounterMatchKey(noWcl.name) !== toEncounterMatchKey(boss.name)) {
        divergencias.push(`${boss.name}: o id ${boss.dungeonEncounterId} é "${noWcl.name}" no WCL`);
      }
    }

    if (divergencias.length > 0) {
      throw new Error(
        `Conferência contra o Warcraft Logs falhou, nada foi gravado:\n  ${divergencias.join('\n  ')}`,
      );
    }

    this.logger.log(`${comId.length} boss(es) conferidos contra o Warcraft Logs`);
  }
}

/**
 * Expande item × dificuldade.
 *
 * O journal da Blizzard dá uma lista de itens e um conjunto de dificuldades, sem
 * dizer quais itens existem em quais — então o padrão é o produto cartesiano.
 * Item que declara as próprias dificuldades sobrepõe as do boss, que é o escape
 * para peça exclusiva de mítico.
 */
function dropsDoBoss(boss: CatalogFileBoss): Array<{
  difficulty: RaidDifficultyLevel;
  itemId: number;
}> {
  const linhas: Array<{ difficulty: RaidDifficultyLevel; itemId: number }> = [];

  for (const item of boss.items) {
    for (const difficulty of item.difficulties ?? boss.difficulties) {
      linhas.push({ difficulty, itemId: item.itemId });
    }
  }

  return linhas;
}

/**
 * Traduz a linha do Prisma para o contrato do shared.
 *
 * Parece cópia, e é de propósito: é aqui que o enum do banco vira o union do
 * `packages/shared`. Se um dia os dois divergirem, é este ponto que quebra no
 * typecheck — em vez de o front receber um valor que ele não sabe tratar.
 */
function toLootCatalogRaid(raid: RaidRow): LootCatalogRaid {
  return {
    id: raid.id,
    slug: raid.slug,
    name: raid.name,
    seasonId: raid.seasonId,
    instanceMapId: raid.instanceMapId,
    encounters: raid.encounters.map((encounter) => ({
      id: encounter.id,
      name: encounter.name,
      position: encounter.position,
      dungeonEncounterId: encounter.dungeonEncounterId,
      drops: encounter.drops.map((drop) => ({
        difficulty: drop.difficulty,
        item: toWowItem(drop.item),
      })),
    })),
  };
}

/**
 * Traduz o item, achatando as specs e convertendo o enum do banco para o slug.
 *
 * `usableBySpecs` vazio com `specsCuratedAt` nulo significa "ninguém revisou",
 * não "nenhuma spec usa". Quem consome precisa tratar os dois casos diferente —
 * é o mesmo cuidado da Regra 7 com lacuna e zero.
 */
function toWowItem(item: ItemRow): WowItem {
  return {
    itemId: item.itemId,
    name: item.name,
    icon: item.icon,
    equipLoc: item.equipLoc,
    itemSubclass: item.itemSubclass,
    primaryStats: item.primaryStats,
    usableBySpecs: item.usableBySpecs.map((s) => SPEC_FROM_DB[s.spec]),
    specsCuratedAt: item.specsCuratedAt?.toISOString() ?? null,
  };
}
