import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LootSessionEventType, LootSessionStatus, RaidDifficultyLevel } from '@titan/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Uma peça a gravar, já normalizada. */
export interface ItemDaSessao {
  position: number;
  itemId: number;
  itemString: string;
  looterName: string;
  looterRealm: string;
}

/** Quem está agindo. Gravado sem FK — ver o comentário do `LootSession`. */
export interface Ator {
  userId: string;
  battletag: string;
}

/** Colunas que a tela da sessão precisa. */
const sessionSelect = {
  id: true,
  status: true,
  difficulty: true,
  rawEncounterName: true,
  rawInstanceName: true,
  createdByBattletag: true,
  createdAt: true,
  openedAt: true,
  encounter: { select: { id: true, name: true, raid: { select: { name: true } } } },
  items: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      itemId: true,
      itemString: true,
      looterName: true,
      looterRealm: true,
    },
  },
} as const;

export type SessionRow = Prisma.LootSessionGetPayload<{ select: typeof sessionSelect }>;

@Injectable()
export class LootSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria a sessão com os itens e o evento de criação, numa transação só.
   *
   * Tudo junto porque sessão sem item não serve, e sessão sem o evento de
   * criação seria um log com buraco logo na primeira linha — e o log é a fonte
   * da verdade.
   */
  async criar(dados: {
    encounterId: string | null;
    rawEncounterId: number | null;
    rawEncounterName: string;
    rawInstanceName: string;
    difficulty: RaidDifficultyLevel | null;
    ator: Ator;
    itens: ItemDaSessao[];
  }): Promise<string> {
    const sessao = await this.prisma.lootSession.create({
      data: {
        encounterId: dados.encounterId,
        rawEncounterId: dados.rawEncounterId,
        rawEncounterName: dados.rawEncounterName,
        rawInstanceName: dados.rawInstanceName,
        difficulty: dados.difficulty,
        createdByUserId: dados.ator.userId,
        createdByBattletag: dados.ator.battletag,
        items: { create: dados.itens },
        events: {
          create: {
            type: 'sessao_criada',
            actorUserId: dados.ator.userId,
            actorBattletag: dados.ator.battletag,
            payload: { itens: dados.itens.length, encounterId: dados.rawEncounterId },
          },
        },
      },
      select: { id: true },
    });

    return sessao.id;
  }

  findById(id: string): Promise<SessionRow | null> {
    return this.prisma.lootSession.findUnique({ where: { id }, select: sessionSelect });
  }

  /** O boss do catálogo com este `dungeonEncounterId`. Único por construção. */
  findEncounterByDungeonId(dungeonEncounterId: number) {
    return this.prisma.lootCatalogEncounter.findUnique({
      where: { dungeonEncounterId },
      select: { id: true },
    });
  }

  /** Nome e ícone dos itens desta sessão, do catálogo. */
  findItems(itemIds: number[]) {
    return this.prisma.wowItem.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, name: true, icon: true, equipLoc: true },
    });
  }

  /**
   * Garante que o `itemID` existe no dicionário.
   *
   * A TIT-63 é explícita: item fora do catálogo **é criado na hora, não
   * recusa a colagem**. O catálogo é cadastro manual e vai ter buraco, e barrar
   * a sessão por causa disso pararia a raid.
   *
   * Cria só com o id; nome e ícone ficam nulos até o enriquecimento passar.
   * `skipDuplicates` porque o normal é o item já existir.
   */
  async garantirItens(itemIds: number[]): Promise<void> {
    if (itemIds.length === 0) return;

    await this.prisma.wowItem.createMany({
      data: [...new Set(itemIds)].map((itemId) => ({ itemId })),
      skipDuplicates: true,
    });
  }

  /** Sessões que ainda não encerraram, mais recentes primeiro. */
  findAbertas() {
    return this.prisma.lootSession.findMany({
      where: { status: { not: 'encerrada' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        difficulty: true,
        rawEncounterName: true,
        rawInstanceName: true,
        createdAt: true,
        encounter: { select: { name: true, raid: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });
  }

  /**
   * Grava a resposta do jogador, **sem nunca tocar no roll de novo**.
   *
   * O `create` gera o roll; o `update` não o menciona. É aqui que o invariante
   * da TIT-65 vive: o roll nasce uma vez por par (jogador, item) e não muda —
   * nem ao trocar a resposta, nem quando o conselho pede para responder de novo.
   *
   * Se este `update` um dia listar `roll`, trocar de resposta vira rerrolar até
   * gostar do número, e ninguém recebe erro.
   *
   * O evento carrega o roll para a auditoria: o roll decide quem leva item, e
   * mais cedo ou mais tarde alguém vai dizer que o site viciou o sorteio. A
   * resposta precisa ser demonstrável, e o log é append-only.
   */
  async responder(dados: {
    sessionId: string;
    itemId: string;
    personagem: { nameKey: string; realmKey: string; name: string; realm: string };
    responseOptionSlug: string;
    roll: number;
    ator: Ator;
  }): Promise<void> {
    const { sessionId, itemId, personagem, responseOptionSlug, roll, ator } = dados;

    // Transação interativa, e não a forma de array: o evento precisa do roll que
    // FICOU, e só a resposta do upsert sabe qual é. Com o array, o evento
    // gravaria o roll recém-sorteado mesmo quando o upsert o descartou — e o log
    // mostraria um número diferente a cada troca de resposta, que é exatamente a
    // aparência de sorteio viciado que ele existe para desmentir.
    await this.prisma.$transaction(async (tx) => {
      const gravada = await tx.lootSessionResponse.upsert({
        where: {
          itemId_nameKey_realmKey: {
            itemId,
            nameKey: personagem.nameKey,
            realmKey: personagem.realmKey,
          },
        },
        create: {
          itemId,
          ...personagem,
          userId: ator.userId,
          responseOptionSlug,
          roll,
        },
        // Sem `roll` — de propósito. Ver o comentário acima.
        update: { responseOptionSlug, aguardandoNovaResposta: false },
        select: { roll: true, createdAt: true, updatedAt: true },
      });

      await tx.lootSessionEvent.create({
        data: {
          sessionId,
          type: 'resposta_dada',
          actorUserId: ator.userId,
          actorBattletag: ator.battletag,
          payload: {
            itemId,
            personagem: `${personagem.name}-${personagem.realm}`,
            responseOptionSlug,
            roll: gravada.roll,
            // Deixa explícito no log que esta resposta não criou roll novo. Sem
            // isto, quem lê quatro eventos com o mesmo roll não sabe se o roll
            // foi mantido ou re-sorteado igual por coincidência.
            rollNovo: gravada.createdAt.getTime() === gravada.updatedAt.getTime(),
          },
        },
      });
    });
  }

  /** As respostas de UM personagem nesta sessão. É o que o jogador pode ver. */
  findRespostasDoPersonagem(sessionId: string, nameKey: string, realmKey: string) {
    return this.prisma.lootSessionResponse.findMany({
      where: { item: { sessionId }, nameKey, realmKey },
      select: {
        itemId: true,
        responseOptionSlug: true,
        roll: true,
        aguardandoNovaResposta: true,
        name: true,
      },
    });
  }

  /** Quantas respostas cada peça já tem. Só a contagem, nunca o conteúdo. */
  async contarRespostas(sessionId: string): Promise<Map<string, number>> {
    const porItem = await this.prisma.lootSessionResponse.groupBy({
      by: ['itemId'],
      where: { item: { sessionId } },
      _count: true,
    });

    return new Map(porItem.map((r) => [r.itemId, r._count]));
  }

  /** A peça é mesmo desta sessão? Evita responder item de outra. */
  async itemPertence(sessionId: string, itemId: string): Promise<boolean> {
    const achado = await this.prisma.lootSessionItem.findFirst({
      where: { id: itemId, sessionId },
      select: { id: true },
    });

    return achado !== null;
  }

  /** Os slugs de resposta ativos. Opção desativada não serve para responder. */
  async findSlugsAtivos(): Promise<string[]> {
    const opcoes = await this.prisma.lootResponseOption.findMany({
      where: { active: true },
      select: { slug: true },
    });

    return opcoes.map((o) => o.slug);
  }

  /** A próxima posição livre. Sessão vazia começa em 1. */
  async proximaPosicao(sessionId: string): Promise<number> {
    const ultimo = await this.prisma.lootSessionItem.findFirst({
      where: { sessionId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return (ultimo?.position ?? 0) + 1;
  }

  /** Acrescenta uma peça e registra o evento, na mesma transação. */
  async adicionarItem(sessionId: string, item: ItemDaSessao, ator: Ator): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.lootSessionItem.create({ data: { sessionId, ...item } }),
      this.registrarEvento(sessionId, 'item_adicionado', ator, { itemId: item.itemId }),
    ]);
  }

  /** Remove uma peça e registra o evento. Devolve false se não era da sessão. */
  async removerItem(sessionId: string, itemId: string, ator: Ator): Promise<boolean> {
    const item = await this.prisma.lootSessionItem.findFirst({
      where: { id: itemId, sessionId },
      select: { id: true, itemId: true },
    });
    if (!item) return false;

    await this.prisma.$transaction([
      this.prisma.lootSessionItem.delete({ where: { id: item.id } }),
      this.registrarEvento(sessionId, 'item_removido', ator, { itemId: item.itemId }),
    ]);

    return true;
  }

  /** Troca o status e registra a transição, com o estado de origem no evento. */
  async trocarStatus(
    sessionId: string,
    de: LootSessionStatus,
    para: LootSessionStatus,
    ator: Ator,
    marcarAbertura: boolean,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.lootSession.update({
        where: { id: sessionId },
        // `openedAt` é carimbado UMA vez: quem decide é o serviço, que sabe se
        // já havia carimbo. Reabrir depois (deliberando → aberta) não pode
        // reescrever quando a sessão começou a receber resposta.
        data: { status: para, ...(marcarAbertura ? { openedAt: new Date() } : {}) },
      }),
      this.registrarEvento(sessionId, 'status_alterado', ator, { de, para }),
    ]);
  }

  private registrarEvento(
    sessionId: string,
    type: LootSessionEventType,
    ator: Ator,
    payload: Prisma.InputJsonValue,
  ) {
    return this.prisma.lootSessionEvent.create({
      data: {
        sessionId,
        type,
        actorUserId: ator.userId,
        actorBattletag: ator.battletag,
        payload,
      },
    });
  }
}
