import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  splitNomeRealm,
  toCharacterKey,
  toRealmMatchKey,
  type LootHistoryEntry,
  type LootHistoryPage,
  type LootHistoryQuery,
} from '@titan/shared';
import { loadGuildConfig, type GuildConfig } from '../config/guild.config';
import {
  LootLinesRepository,
  type CatalogItemRow,
  type LootHistoryRow,
} from './loot-lines.repository';

/**
 * Nenhum item casa com isto, e é o ponto.
 *
 * Usado quando o filtro de slot não encontra item nenhum no catálogo: a resposta
 * certa é lista vazia, não "ignora o filtro e devolve tudo". `itemId IN ()` é
 * inválido em SQL, então precisa de um valor impossível — e `itemId` é sempre
 * positivo.
 */
const NENHUM_ITEM = -1;

@Injectable()
export class LootHistoryService {
  private readonly guild: GuildConfig;

  constructor(private readonly repo: LootLinesRepository) {
    this.guild = loadGuildConfig();
  }

  /**
   * Uma página do histórico, com os filtros aplicados.
   *
   * Três consultas, não uma: as linhas, a contagem (junto, na mesma transação)
   * e os itens do catálogo. O item vem à parte porque não há FK entre linha de
   * loot e catálogo — ver `findItems`.
   */
  async consultar(filtros: LootHistoryQuery): Promise<LootHistoryPage> {
    const where = await this.montarWhere(filtros);
    const { linhas, total } = await this.repo.findHistoryPage(
      where,
      filtros.page,
      filtros.pageSize,
    );

    const itens = await this.buscarItens(linhas);

    return {
      entries: linhas.map((linha) => montarEntrada(linha, itens)),
      total,
      page: filtros.page,
      pageSize: filtros.pageSize,
    };
  }

  /** Os filtros da query viram o `where` do Prisma. */
  private async montarWhere(filtros: LootHistoryQuery): Promise<Prisma.LootLineWhereInput> {
    const where: Prisma.LootLineWhereInput = {};

    const personagem = identidadeDoPersonagem(filtros.character);
    if (personagem) {
      where.winnerNameKey = personagem.nameKey;
      where.winnerRealmKey = personagem.realmKey;
    }

    const janela = janelaDeDatas(filtros.from, filtros.to, this.guild.timezone);
    if (janela) where.awardedAt = janela;

    if (filtros.encounterId) where.encounterId = filtros.encounterId;
    if (filtros.difficulty) where.difficulty = filtros.difficulty;

    if (filtros.slot) {
      const itemIds = await this.repo.findItemIdsBySlot(filtros.slot);
      where.itemId = { in: itemIds.length > 0 ? itemIds : [NENHUM_ITEM] };
    }

    return where;
  }

  /** Um lookup dos itens desta página, sem repetir id. */
  private async buscarItens(linhas: LootHistoryRow[]): Promise<Map<number, CatalogItemRow>> {
    const ids = [...new Set(linhas.map((l) => l.itemId))];
    if (ids.length === 0) return new Map();

    const itens = await this.repo.findItems(ids);
    return new Map(itens.map((item) => [item.itemId, item]));
  }
}

/**
 * `Fulano-Area52` → a identidade normalizada, do jeito que está gravada.
 *
 * `toCharacterKey` MANTÉM acento (Shrëwd e Shrêwd são pessoas diferentes) e
 * `toRealmMatchKey` colapsa separador, que é o que faz `Area52` da fonte casar
 * com `area-52` do roster — Regra 6.
 *
 * Sem hífen devolve `null`, e o filtro é ignorado em vez de recusar o request:
 * nome sem realm não identifica ninguém, e barrar a tela inteira por causa de um
 * campo mal preenchido é pior que mostrar tudo.
 */
function identidadeDoPersonagem(
  bruto: string | undefined,
): { nameKey: string; realmKey: string } | null {
  if (!bruto) return null;

  const par = splitNomeRealm(bruto);
  if (!par) return null;

  return { nameKey: toCharacterKey(par.name), realmKey: toRealmMatchKey(par.realm) };
}

/**
 * A janela de datas, inclusiva nas duas pontas, **no fuso da guilda**.
 *
 * Não em UTC, e a diferença não é cosmética: a raid começa 21:00 BRT, que já é o
 * dia seguinte em UTC. Medido nas 294 entregas importadas — todas caem entre
 * 00:33 e 02:40 UTC, ou seja, **nenhuma** está no dia UTC em que a raid
 * aconteceu. Filtrar `from=2026-03-17&to=2026-03-17` em UTC devolveria zero para
 * a noite de 17/03.
 *
 * É o mesmo achado que o `attendance.service.ts` já registrava por outro
 * caminho: por data UTC só 12 de 20 logs caíam numa data com raid marcada; pelo
 * fuso da guilda, 19.
 *
 * O `to` vai até o fim do dia local. Sem isso, `to=<dia>` viraria meia-noite e
 * esconderia a noite inteira — justamente a que a pessoa pediu.
 */
function janelaDeDatas(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;

  const janela: Prisma.DateTimeFilter = {};
  if (from) janela.gte = instanteLocal(from, '00:00:00.000', timezone);
  if (to) janela.lte = instanteLocal(to, '23:59:59.999', timezone);

  return janela;
}

/**
 * `2026-03-17` + `00:00:00.000` no fuso da guilda → o instante UTC equivalente.
 *
 * Feito à mão porque não há biblioteca de data no projeto e o caso é estreito.
 * O truque é medir o deslocamento do fuso **naquele instante** e descontá-lo.
 *
 * Uma passada basta para o fuso da guilda: o Brasil não tem horário de verão
 * desde 2019, então `America/Sao_Paulo` é `-03:00` fixo. Em fuso com DST, um
 * horário na hora exata da virada pode escorregar uma hora — aceitável para
 * filtro de dia, e registrado aqui para não parecer descuido.
 */
function instanteLocal(dia: string, hora: string, timezone: string): Date {
  const comoSeFosseUtc = new Date(`${dia}T${hora}Z`);
  return new Date(comoSeFosseUtc.getTime() - deslocamentoDoFuso(comoSeFosseUtc, timezone));
}

/** Quanto o fuso está à frente do UTC naquele instante, em milissegundos. */
function deslocamentoDoFuso(instante: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const campo = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  // Os milissegundos vêm do próprio instante: o `Intl` só chega ao segundo, e
  // sem isto eles vazariam para dentro do deslocamento. O sintoma foi um `lte`
  // de 23:59:59.999 virar 00:00:00.998 do dia seguinte — quase invisível, e
  // suficiente para a borda do filtro ficar errada.
  const local =
    Date.UTC(
      campo('year'),
      campo('month') - 1,
      campo('day'),
      campo('hour'),
      campo('minute'),
      campo('second'),
    ) + instante.getUTCMilliseconds();

  return local - instante.getTime();
}

/** Uma linha do banco vira uma entrada de tela. */
function montarEntrada(
  linha: LootHistoryRow,
  itens: Map<number, CatalogItemRow>,
): LootHistoryEntry {
  const item = itens.get(linha.itemId);

  return {
    id: linha.id,
    awardedAt: linha.awardedAt.toISOString(),

    winner: {
      name: linha.winnerName,
      realm: linha.winnerRealm,
      nameKey: linha.winnerNameKey,
      realmKey: linha.winnerRealmKey,
    },
    winnerClass: linha.winnerClass,

    item: {
      itemId: linha.itemId,
      // Nulo, e não o `itemName` da linha: aquele vem localizado pelo cliente de
      // quem era loot master, e o mesmo item apareceria em dois idiomas na
      // mesma lista. Melhor faltar do que mentir — ver TIT-49.
      name: item?.name ?? null,
      icon: item?.icon ?? null,
      equipLoc: item?.equipLoc ?? null,
    },

    boss: {
      encounterId: linha.encounter?.id ?? null,
      name: linha.encounter?.name ?? linha.rawBoss,
      raid: linha.encounter?.raid.name ?? linha.rawInstance,
    },

    difficulty: linha.difficulty,
    response: { slug: linha.responseOption.slug, label: linha.responseOption.label },
    votes: linha.votes,
    note: linha.note,
  };
}
