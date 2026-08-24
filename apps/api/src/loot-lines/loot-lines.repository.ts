import { Injectable } from '@nestjs/common';
import type { LootLineSource, LootResponseKind, RaidDifficultyLevel } from '@titan/shared';
import { Prisma } from '@prisma/client';
import { characterSelect } from '../characters/characters.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { SeasonInicio } from './season-da-entrega';

/**
 * Uma linha pronta para gravar.
 *
 * Campo a campo de propósito, e não um spread do registro da fonte: o export tem
 * 22 campos e a tabela guarda outros, então espalhar o objeto inteiro faria o
 * Prisma receber colunas que não existem — erro em runtime, longe daqui.
 *
 * Todos os campos de sessão (`sessionId`, `awardedByUserId`,
 * `awardedByBattletag`, `councilNote`) ficam nulos aqui: quem os preenche é o
 * encerramento de sessão (TIT-69), não o import.
 */
export interface LootLineUpsert {
  source: LootLineSource;
  externalId: string;
  sessionId: null;
  awardedAt: Date;
  awardedByUserId: null;
  awardedByBattletag: null;

  /** Identidades já resolvidas — quem resolve é o `CharactersRepository`. */
  winnerCharacterId: string;
  looterCharacterId: string | null;

  itemId: number;
  itemString: string;

  encounterId: string | null;
  difficulty: RaidDifficultyLevel | null;

  /** A season em que a entrega aconteceu. Nula quando não dá para datar. */
  seasonId: number | null;

  responseOptionSlug: string;

  /** O `kind` da opção, congelado no momento do import — nunca o de hoje. */
  responseKind: LootResponseKind;

  votes: number | null;
  playerNote: string | null;
  councilNote: null;

  /** O registro do export, inteiro e sem interpretar. */
  rawImportedLine: Prisma.InputJsonValue;
}

/**
 * Uma linha do encerramento de sessão, pronta para gravar.
 *
 * Irmã do `LootLineUpsert`, com a nulidade espelhada — de propósito (TIT-69).
 * Lá os quatro campos de sessão são literal `null`, guardrail para o import
 * nunca preencher campo de sessão; aqui `sessionId` e `awardedBy*` são
 * obrigatórios, e é `rawImportedLine` que vira literal `null` — a sessão ao
 * vivo nasce no nosso formato, sem fonte externa a preservar. O compilador
 * garante os dois lados.
 *
 * `votes` é `number`, não `number | null`: `LootSessionAward.votes` nunca é
 * nulo (zero é resultado legítimo — entrega à mão e `pass item to` não passam
 * por votação), diferente do import, onde a fonte pode não ter o conceito.
 */
export interface LootLineFromSession {
  source: LootLineSource;
  externalId: string;
  sessionId: string;
  awardedAt: Date;
  awardedByUserId: string;
  awardedByBattletag: string;

  winnerCharacterId: string;
  looterCharacterId: string | null;

  itemId: number;
  itemString: string;

  encounterId: string | null;
  difficulty: RaidDifficultyLevel | null;

  seasonId: number | null;

  responseOptionSlug: string;
  responseKind: LootResponseKind;

  votes: number;
  playerNote: string | null;
  councilNote: string | null;

  rawImportedLine: null;
}

/** Um boss do catálogo, o mínimo para casar com o nome que a fonte escreveu. */
export interface EncounterRef {
  id: string;
  name: string;
}

@Injectable()
export class LootLinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos os bosses do catálogo.
   *
   * A lista inteira de uma vez, e não uma consulta por linha: são quatro raids e
   * algumas dezenas de bosses contra 294 linhas a importar. Uma consulta e um
   * `Map` na memória batem 294 idas ao banco sem chegar perto de pesar.
   */
  findEncounters(): Promise<EncounterRef[]> {
    return this.prisma.lootCatalogEncounter.findMany({ select: { id: true, name: true } });
  }

  /**
   * As seasons, para datar cada entrega.
   *
   * Todas de uma vez: são poucas — uma por patch — e o import precisa comparar
   * cada uma das 294 linhas contra elas.
   */
  findSeasons(): Promise<SeasonInicio[]> {
    return this.prisma.gameSeason.findMany({ select: { id: true, startedAt: true } });
  }

  /**
   * As opções de resposta que existem hoje, com o `kind` para congelar na
   * linha — nunca o de uma leitura futura, que a TIT-64 pode ter editado.
   */
  findResponseOptions(): Promise<Array<{ slug: string; kind: LootResponseKind }>> {
    return this.prisma.lootResponseOption.findMany({ select: { slug: true, kind: true } });
  }

  /**
   * Grava as linhas, atualizando as que já existem.
   *
   * Tudo numa transação só: ou o arquivo entrou, ou não entrou. Import pela
   * metade é pior que import nenhum, porque parece que funcionou — e a contagem
   * final é justamente o critério de aceite.
   *
   * A chave é `(source, externalId)`, que é o que faz rodar duas vezes atualizar
   * em vez de duplicar.
   */
  async upsertMany(linhas: LootLineUpsert[]): Promise<number> {
    const gravacoes = linhas.map((linha) =>
      this.prisma.lootLine.upsert({
        where: { source_externalId: { source: linha.source, externalId: linha.externalId } },
        create: linha,
        update: linha,
      }),
    );

    const feitas = await this.prisma.$transaction(gravacoes);
    return feitas.length;
  }

  countBySource(source: LootLineSource): Promise<number> {
    return this.prisma.lootLine.count({ where: { source } });
  }

  /**
   * Grava as linhas do encerramento de uma sessão. Irmã do `upsertMany`, mesma
   * chave (`source, externalId`) — mesma trava de duplicata.
   *
   * `tx` é OPCIONAL: cai em `this.prisma` quando ausente, para não obrigar quem
   * chama fora de transação (a rota de ops que regera o histórico) a inventar
   * uma. Quando `loot-sessions` chama durante o encerramento, passa o client da
   * PRÓPRIA transação — é o que faz a troca de status e a gravação da linha
   * commitarem juntas (TIT-69). Convenção nova neste projeto: ver o comentário
   * da issue sobre por que a alternativa (loot-sessions escrevendo direto
   * nesta tabela) era pior.
   *
   * Sem client externo, ainda assim tudo numa transação só — mesmo motivo do
   * `upsertMany`: ou a sessão inteira virou histórico, ou nenhuma linha dela
   * virou.
   */
  async upsertDaSessao(
    linhas: LootLineFromSession[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (tx) {
      const feitas = await Promise.all(linhas.map((linha) => upsertLinhaDaSessao(tx, linha)));
      return feitas.length;
    }

    const feitas = await this.prisma.$transaction(
      linhas.map((linha) => upsertLinhaDaSessao(this.prisma, linha)),
    );
    return feitas.length;
  }

  /**
   * Uma página do histórico, com o total sob os mesmos filtros.
   *
   * Os dois numa transação só para a contagem não discordar da página quando um
   * import roda no meio — a tela diria "37 entregas" mostrando 38.
   *
   * Ordem: mais recente primeiro, com o `id` desempatando. Sem o desempate, duas
   * entregas do mesmo instante — o export tem esse caso — podem trocar de lugar
   * entre uma página e outra, e a mesma linha aparece duas vezes ou some.
   */
  async findHistoryPage(
    where: Prisma.LootLineWhereInput,
    page: number,
    pageSize: number,
  ): Promise<{ linhas: LootHistoryRow[]; total: number }> {
    const [linhas, total] = await this.prisma.$transaction([
      this.prisma.lootLine.findMany({
        where,
        orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: historySelect,
      }),
      this.prisma.lootLine.count({ where }),
    ]);

    return { linhas, total };
  }

  /**
   * Os itens do catálogo referenciados por estas linhas.
   *
   * Consulta separada, e não `include`, porque **não existe FK de `LootLine`
   * para `WowItem`** — de propósito. FK obrigatória recusaria histórico cujo
   * item o catálogo ainda não tem, e catálogo atrasado não pode barrar registro
   * que não volta (Regra 7). Mesmo motivo pelo qual `encounterId` é nulável.
   */
  findItems(itemIds: number[]): Promise<CatalogItemRow[]> {
    return this.prisma.wowItem.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, name: true, icon: true, equipLoc: true, itemSubclass: true },
    });
  }

  /**
   * Quantas entregas por season, incluindo a fatia sem season.
   *
   * Sem filtro de season de propósito: é o seletor de season, e ele precisa
   * oferecer para onde ir, não só onde se está.
   */
  // Sem anotação de retorno: o `groupBy` do Prisma é genérico e infere o tipo a
  // partir dos argumentos. Anotar faz o TS tentar unificar as duas coisas e
  // devolver um erro que aponta para o lugar errado.
  contarPorSeason() {
    // Sem `orderBy`: quem ordena é o serviço, que precisa pôr a fatia sem season
    // por último — regra que não cabe no `groupBy`.
    return this.prisma.lootLine.groupBy({ by: ['seasonId'], _count: true });
  }

  /** Nome das seasons que aparecem no histórico. */
  findSeasonNames(ids: number[]): Promise<Array<{ id: number; name: string }>> {
    return this.prisma.gameSeason.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  /** Personagens que aparecem, com a grafia da fonte para exibir. */
  contarPorPersonagem(where: Prisma.LootLineWhereInput) {
    return this.prisma.lootLine.groupBy({
      by: ['winnerCharacterId'],
      where,
      _count: true,
    });
  }

  /** Nome e realm destas identidades, para a faceta virar rótulo. */
  findCharacterNames(ids: string[]) {
    return this.prisma.character.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, realm: true },
    });
  }

  /** A identidade deste par nome + realm, se existir. Não cria. */
  findCharacterByKeys(nameKey: string, realmKey: string) {
    return this.prisma.character.findUnique({
      where: { nameKey_realmKey: { nameKey, realmKey } },
      select: { id: true },
    });
  }

  /** Bosses que aparecem, já resolvidos — linha sem boss não vira opção. */
  contarPorBoss(where: Prisma.LootLineWhereInput) {
    return this.prisma.lootLine.groupBy({
      by: ['encounterId'],
      where: { ...where, encounterId: { not: null } },
      _count: true,
    });
  }

  /** Nome e raid dos bosses, para o rótulo do seletor. */
  findEncounterLabels(ids: string[]) {
    return this.prisma.lootCatalogEncounter.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, raid: { select: { name: true } } },
    });
  }

  /**
   * Quantas entregas por item.
   *
   * O slot sai daqui somando por `equipLoc`, e não de um `groupBy` direto, porque
   * **não há FK entre linha de loot e catálogo** — o Prisma não tem como juntar
   * as duas tabelas numa consulta só.
   */
  contarPorItem(where: Prisma.LootLineWhereInput) {
    return this.prisma.lootLine.groupBy({ by: ['itemId'], where, _count: true });
  }

  /**
   * `itemId` + `itemString` de toda linha do histórico.
   *
   * Usado pelo relatório de "o que ainda não conhecemos" (TIT-82) — quem
   * extrai os `bonusIds` e agrega por frequência é o `WowDataReportService`,
   * não este repository: a mesma consulta crua alimenta a mesma extração para
   * `LootSessionItem`, e a leitura fica igual nos dois lados.
   */
  findAllItemStrings(): Promise<Array<{ itemId: number; itemString: string }>> {
    return this.prisma.lootLine.findMany({ select: { itemId: true, itemString: true } });
  }

  /** Os `itemId` de um slot, para o filtro de slot virar `itemId IN (...)`. */
  async findItemIdsBySlot(equipLoc: string): Promise<number[]> {
    const itens = await this.prisma.wowItem.findMany({
      where: { equipLoc },
      select: { itemId: true },
    });

    return itens.map((i) => i.itemId);
  }
}

/**
 * O `upsert` de uma linha de sessão, contra o client que o chamador passou.
 *
 * `rawImportedLine` vira `Prisma.JsonNull`, não o `null` do TypeScript: campo
 * JSON nulável no Prisma distingue "coluna SQL nula" de "JSON contendo
 * `null`", e só o marcador aceita ir para `create`/`update`. `null` no tipo
 * `LootLineFromSession` continua sendo o guardrail — é aqui, na única borda
 * que fala com o Prisma, que ele vira o valor que a API do client aceita.
 */
function upsertLinhaDaSessao(client: Prisma.TransactionClient, linha: LootLineFromSession) {
  const dados = { ...linha, rawImportedLine: Prisma.JsonNull };

  return client.lootLine.upsert({
    where: { source_externalId: { source: linha.source, externalId: linha.externalId } },
    create: dados,
    update: dados,
  });
}

/**
 * Colunas que a tela do histórico precisa.
 *
 * Sem `rawBoss`/`rawInstance` desde a TIT-130: não há mais fallback de bruto
 * picado, boss não resolvido vira lacuna na tela. `responseKind` entra porque é
 * o congelado da linha — nunca `responseOption.kind`, que pode ter mudado.
 */
const historySelect = {
  id: true,
  awardedAt: true,
  winner: { select: { ...characterSelect, class: true } },
  itemId: true,
  // O `itemString` cru — TIT-135: `WowItemStatsService.calcularVarios` (o
  // payload de stats) chaveia por ele, não por `itemId`.
  itemString: true,
  difficulty: true,
  votes: true,
  playerNote: true,
  responseKind: true,
  encounter: { select: { id: true, name: true, raid: { select: { name: true } } } },
  responseOption: { select: { slug: true, label: true } },
} as const;

export type LootHistoryRow = Prisma.LootLineGetPayload<{ select: typeof historySelect }>;
export type CatalogItemRow = {
  itemId: number;
  name: string | null;
  icon: string | null;
  equipLoc: string | null;
  itemSubclass: string | null;
};
