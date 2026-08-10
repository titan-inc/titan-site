import { Injectable, Logger } from '@nestjs/common';
import {
  PRIMARY_STATS,
  RAID_DIFFICULTIES,
  type CatalogFile,
  type CatalogFileBoss,
  type CatalogFileItem,
  type JournalDump,
  type PrimaryStat,
  type RaidDifficultyLevel,
  type WowSpec,
} from '@titan/shared';
import { BlizzardService } from '../blizzard/blizzard.service';
import { WarcraftLogsService, type RaidEncounter } from '../warcraftlogs/warcraftlogs.service';

/**
 * Monta o arquivo de catálogo a partir da Blizzard e do Warcraft Logs, para o
 * humano revisar em vez de digitar.
 *
 * `usableBySpecs` é o único campo que ainda depende de gente. Com o dump do
 * cliente sai uma **proposta** — o journal do WoW sabe distinguir trinket de
 * healer de trinket de caster com o mesmo intelecto — mas ela responde "quem
 * pode equipar e aproveita", não "a guilda deixa rolar". Ver TIT-77.
 */

/** `LFR` fica de fora: a guilda não roda, e o enum do sistema não tem o valor. */
const DIFICULDADE_POR_MODE: Record<string, RaidDifficultyLevel> = {
  NORMAL: RAID_DIFFICULTIES.NORMAL,
  HEROIC: RAID_DIFFICULTIES.HEROIC,
  MYTHIC: RAID_DIFFICULTIES.MYTHIC,
};

/** Quanto o WCL soma no id para espelhar uma zona de teste. Ver `semEspelhosDeTeste`. */
const OFFSET_ZONA_DE_TESTE = 50_000;

/** Os três primários. O resto de `preview_item.stats` é secundário. */
const PRIMARIO_POR_STAT: Record<string, PrimaryStat> = {
  STRENGTH: PRIMARY_STATS.STRENGTH,
  AGILITY: PRIMARY_STATS.AGILITY,
  INTELLECT: PRIMARY_STATS.INTELLECT,
};

@Injectable()
export class LootCatalogGeneratorService {
  private readonly logger = new Logger(LootCatalogGeneratorService.name);

  constructor(
    private readonly blizzard: BlizzardService,
    private readonly wcl: WarcraftLogsService,
  ) {}

  /**
   * Gera o arquivo de uma raid do Encounter Journal.
   *
   * Orquestra: lê a raid, resolve o `dungeonEncounterId` de cada boss, e
   * enriquece cada item. Falha antes de produzir arquivo se algum id for
   * ambíguo — arquivo pela metade é pior que arquivo nenhum, porque parece
   * pronto.
   */
  async gerar(journalInstanceId: number, slug?: string, dump?: JournalDump): Promise<CatalogFile> {
    const instancia = await this.blizzard.getJournalInstance(journalInstanceId);
    this.logger.log(`${instancia.name}: ${instancia.encounters.length} boss(es) no journal`);

    const idPorJournal = this.idsDoDump(journalInstanceId, dump);
    const idPorNome = idPorJournal
      ? new Map<string, number>()
      : await this.idsDoWcl(instancia.encounters.map((e) => e.name));

    const specsPorItem = specsDoDump(dump);
    const cache = new Map<number, CatalogFileItem>();
    const bosses: CatalogFileBoss[] = [];

    for (const [posicao, resumo] of instancia.encounters.entries()) {
      const encontro = await this.blizzard.getJournalEncounter(resumo.id);

      const difficulties = encontro.modes
        .map((m) => DIFICULDADE_POR_MODE[m.type])
        .filter((d): d is RaidDifficultyLevel => d !== undefined);

      if (difficulties.length === 0) {
        throw new Error(
          `${encontro.name}: nenhuma dificuldade conhecida em [${encontro.modes.map((m) => m.type).join(', ')}]`,
        );
      }

      const items: CatalogFileItem[] = [];
      for (const entrada of encontro.items) {
        items.push(await this.item(entrada.item.id, cache, specsPorItem));
      }

      bosses.push({
        name: encontro.name,
        position: posicao,
        dungeonEncounterId: idPorJournal
          ? idPorJournal.get(resumo.id)
          : idPorNome.get(encontro.name),
        difficulties: difficulties as CatalogFileBoss['difficulties'],
        items,
      });

      this.logger.log(`  ${encontro.name}: ${items.length} item(ns)`);
    }

    if (bosses.length === 0) {
      throw new Error(`${instancia.name} não tem boss nenhum no journal`);
    }

    return {
      version: 1,
      slug: slug ?? toSlugSimples(instancia.name),
      name: instancia.name,
      // Procedência: é por ele que se regera o arquivo depois de um hotfix, sem
      // caçar o número entre as 210 instâncias do índice.
      journalInstanceId,
      // Vinha vazio desde o TIT-46: o campo estava modelado nos dois schemas e
      // ninguém preenchia, embora a Blizzard devolva de graça.
      ...((dump?.instanceMapId ?? instancia.map?.id)
        ? { instanceMapId: dump?.instanceMapId ?? instancia.map?.id }
        : {}),
      bosses: bosses as CatalogFile['bosses'],
    };
  }

  /**
   * `journalEncounterId` → `dungeonEncounterId`, direto do cliente do WoW.
   *
   * Quando existe dump, ele **substitui** o casamento por nome contra o WCL: o
   * cliente é a única fonte que publica a ponte entre os dois espaços de id, e
   * casar por id não sofre com nome repetido entre expansões nem com boss
   * renomeado num patch.
   *
   * Devolve `undefined` quando não há dump, e aí o gerador cai no nome.
   */
  private idsDoDump(
    journalInstanceId: number,
    dump?: JournalDump,
  ): Map<number, number> | undefined {
    if (!dump) return undefined;

    // Dump da raid errada é o erro fácil de cometer com dois arquivos abertos,
    // e sem esta checagem ele produziria uma raid inteira sem id nenhum.
    if (dump.journalInstanceId !== journalInstanceId) {
      throw new Error(
        `o dump é da instância ${dump.journalInstanceId} e você pediu a ${journalInstanceId}`,
      );
    }

    const ids = new Map<number, number>();
    const semId: number[] = [];

    for (const boss of dump.bosses) {
      if (boss.dungeonEncounterId) ids.set(boss.journalEncounterId, boss.dungeonEncounterId);
      else semId.push(boss.journalEncounterId);
    }

    if (semId.length > 0) {
      this.logger.warn(`${semId.length} boss(es) sem id no dump: ${semId.join(', ')}`);
    }

    this.logger.log(`Dump do cliente: ${ids.size} de ${dump.bosses.length} boss(es) com id`);
    return ids;
  }

  /**
   * Resolve o `dungeonEncounterId` de cada boss pelo nome, contra o WCL.
   *
   * O casamento é por nome porque journal e jogo usam espaços de id diferentes e
   * não há ponte numérica entre eles — mas os nomes batem exatamente nas três
   * fontes (Blizzard, WCL e o addon), verificado com sete ids reais.
   *
   * Nome que aparece em mais de um encounter do WCL é recusado em vez de
   * escolhido: pegar o primeiro gravaria o boss de outra raid, e o sintoma só
   * apareceria como "a colagem não casa" numa noite de raid.
   */
  private async idsDoWcl(nomes: string[]): Promise<Map<string, number>> {
    const catalogo = await this.wcl.getRaidCatalog();

    const porNome = new Map<string, number[]>();
    for (const boss of semEspelhosDeTeste(catalogo.encounters)) {
      porNome.set(boss.name, [...(porNome.get(boss.name) ?? []), boss.id]);
    }

    const resolvidos = new Map<string, number>();
    const ambiguos: string[] = [];
    const ausentes: string[] = [];

    for (const nome of nomes) {
      const achados = porNome.get(nome) ?? [];

      if (achados.length === 1) resolvidos.set(nome, achados[0] as number);
      else if (achados.length > 1) ambiguos.push(`${nome} (ids ${achados.join(', ')})`);
      else ausentes.push(nome);
    }

    if (ambiguos.length > 0) {
      throw new Error(
        `Nome ambíguo no Warcraft Logs, não dá para escolher o id:\n  ${ambiguos.join('\n  ')}`,
      );
    }

    if (ausentes.length > 0) {
      // Não é erro fatal: raid recém-lançada existe no journal antes de o WCL
      // conhecê-la. O boss sai sem id, e o carregador avisa.
      this.logger.warn(
        `${ausentes.length} boss(es) sem id no Warcraft Logs: ${ausentes.join(', ')}`,
      );
    }

    return resolvidos;
  }

  /**
   * Enriquece um item, com cache por `itemId`.
   *
   * O cache existe porque a mesma peça pode cair de mais de um boss, e cada item
   * custa duas chamadas — uma de dado, uma de mídia.
   *
   * `usableBySpecs` só é escrito quando vem do dump, e sempre acompanhado de
   * `specsFromClient` — é isso que impede o carregador de gravá-lo como decisão
   * humana. Sem dump o campo é omitido, porque não há de onde derivar.
   */
  private async item(
    itemId: number,
    cache: Map<number, CatalogFileItem>,
    specsPorItem: Map<number, WowSpec[]>,
  ): Promise<CatalogFileItem> {
    const emCache = cache.get(itemId);
    if (emCache) return emCache;

    const [dados, icon] = await Promise.all([
      this.blizzard.getItem(itemId),
      this.blizzard.getItemIcon(itemId),
    ]);

    const primaryStats = (dados.preview_item?.stats ?? [])
      .map((s) => PRIMARIO_POR_STAT[s.type?.type ?? ''])
      .filter((p): p is PrimaryStat => p !== undefined);

    const specs = specsPorItem.get(itemId) ?? [];

    const item: CatalogFileItem = {
      itemId,
      name: dados.name,
      ...(icon ? { icon } : {}),
      // `inventory_type.type` da REST: `TRINKET`, `HEAD`, `WEAPON`. A API Lua do
      // cliente chama o mesmo slot de `INVTYPE_TRINKET`, porque lá a string é
      // chave de localização. Comparar as duas grafias casa errado sem erro.
      ...(dados.inventory_type?.type ? { equipLoc: dados.inventory_type.type } : {}),
      ...(dados.item_subclass?.name ? { itemSubclass: dados.item_subclass.name } : {}),
      ...(primaryStats.length > 0 ? { primaryStats } : {}),
      // A marca vai SEMPRE junto da lista, nunca separada: lista sem marca é o
      // que o carregador lê como assinatura humana.
      ...(specs.length > 0 ? { usableBySpecs: specs, specsFromClient: true } : {}),
    };

    cache.set(itemId, item);
    return item;
  }
}

/**
 * `itemId` → specs que o journal do cliente mostra para a peça.
 *
 * O mesmo item pode cair de mais de um boss, e a lista é a mesma nos dois — o
 * filtro do journal é propriedade do item, não do encontro. Fica a primeira
 * aparição.
 *
 * Mapa vazio sem dump, e aí nenhum item sai com specs: derivar de
 * `primaryStats` + `equipLoc` daria uma lista pior que a do cliente, que sabe
 * distinguir trinket de healer de trinket de caster com o mesmo intelecto.
 */
function specsDoDump(dump?: JournalDump): Map<number, WowSpec[]> {
  const porItem = new Map<number, WowSpec[]>();
  if (!dump) return porItem;

  for (const boss of dump.bosses) {
    for (const item of boss.items) {
      if (!porItem.has(item.itemId)) porItem.set(item.itemId, item.specs);
    }
  }

  return porItem;
}

/**
 * Descarta os espelhos de PTR/Beta do catálogo do WCL.
 *
 * Enquanto uma raid está em teste o WCL a publica **duas vezes**: a zona ao vivo
 * e uma de PTR/Beta, cujos encounters repetem o mesmo nome com o id somado de
 * 50000. Sem isto toda raid em teste sai ambígua — e raid em teste é exatamente
 * a que precisa ser gerada, porque é a que ainda não está no catálogo.
 *
 * O critério **não** é "id alto", é ter um gêmeo exato em `id - 50000` com o
 * mesmo nome. Assim um encounter ao vivo que um dia nasça com id alto continua
 * passando, em vez de sumir em silêncio.
 *
 * O nome da zona não serve de critério: em 09/08/2026 as zonas 53 e 54 se
 * chamam as duas "The Venomous Abyss", sem sufixo que as distinga. Só duas das
 * três zonas espelhadas dizem `(Beta)` ou `(PTR)` no nome.
 *
 * O que sobra depois disto é ambiguidade de verdade: `Artificer Xy'mox` existe
 * em Castle Nathria (2405) e em Sepulcher (2553), dois bosses diferentes que
 * dividem o nome.
 */
function semEspelhosDeTeste(encounters: Map<number, RaidEncounter>): RaidEncounter[] {
  return [...encounters.values()].filter((boss) => {
    if (boss.id < OFFSET_ZONA_DE_TESTE) return true;
    return encounters.get(boss.id - OFFSET_ZONA_DE_TESTE)?.name !== boss.name;
  });
}

/** Slug de nome de raid. Só para sugerir; quem gera pode passar o seu. */
function toSlugSimples(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
