import { Injectable } from '@nestjs/common';
import { Prisma, type LootResponseKind } from '@prisma/client';
import {
  LOOT_RESPONSES,
  type LootSessionEventType,
  type LootSessionStatus,
  type RaidDifficultyLevel,
} from '@titan/shared';
import { characterSelect, CharactersRepository } from '../characters/characters.repository';
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
      looter: { select: characterSelect },
    },
  },
} as const;

export type SessionRow = Prisma.LootSessionGetPayload<{ select: typeof sessionSelect }>;

@Injectable()
export class LootSessionsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly characters: CharactersRepository,
  ) {}

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
    const itensParaCriar = [];
    for (const item of dados.itens) itensParaCriar.push(await this.paraCriarItem(item));

    const sessao = await this.prisma.lootSession.create({
      data: {
        encounterId: dados.encounterId,
        rawEncounterId: dados.rawEncounterId,
        rawEncounterName: dados.rawEncounterName,
        rawInstanceName: dados.rawInstanceName,
        difficulty: dados.difficulty,
        createdByUserId: dados.ator.userId,
        createdByBattletag: dados.ator.battletag,
        items: { create: itensParaCriar },
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
    /** `undefined` mantém a nota que já existe; `null` apaga. */
    note: string | null | undefined;
    ator: Ator;
  }): Promise<void> {
    const { sessionId, itemId, personagem, responseOptionSlug, roll, note, ator } = dados;
    const characterId = await this.exigirIdentidade(personagem);

    // Transação interativa, e não a forma de array: o evento precisa do roll que
    // FICOU, e só a resposta do upsert sabe qual é. Com o array, o evento
    // gravaria o roll recém-sorteado mesmo quando o upsert o descartou — e o log
    // mostraria um número diferente a cada troca de resposta, que é exatamente a
    // aparência de sorteio viciado que ele existe para desmentir.
    await this.prisma.$transaction(async (tx) => {
      const gravada = await tx.lootSessionResponse.upsert({
        where: { itemId_characterId: { itemId, characterId } },
        create: {
          itemId,
          characterId,
          userId: ator.userId,
          responseOptionSlug,
          roll,
          // `undefined` aqui vira nulo, que é o certo: quem nunca mandou nota
          // não tem nota.
          note,
        },
        // Sem `roll` — de propósito. Ver o comentário acima.
        //
        // Com `note`, e a semântica é a do Prisma: `undefined` não entra no
        // UPDATE, então trocar só a escolha preserva o que a pessoa escreveu.
        // Apagar exige mandar o campo vazio — se omitir apagasse, um cliente
        // que esquecesse o campo limparia a nota em silêncio.
        update: { responseOptionSlug, note, aguardandoNovaResposta: false },
        select: { roll: true, note: true, createdAt: true, updatedAt: true },
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
            // O texto não vai para o log: a linha da resposta já é o registro
            // dele, e duplicar criaria duas cópias do mesmo texto de pessoa em
            // tabelas com propósitos diferentes.
            comNota: gravada.note !== null,
            // Deixa explícito no log que esta resposta não criou roll novo. Sem
            // isto, quem lê quatro eventos com o mesmo roll não sabe se o roll
            // foi mantido ou re-sorteado igual por coincidência.
            rollNovo: gravada.createdAt.getTime() === gravada.updatedAt.getTime(),
          },
        },
      });
    });
  }

  /**
   * Entra na sessão, ou troca o personagem de quem já entrou.
   *
   * `upsert` na chave `(sessionId, userId)`: a participação é por PESSOA, e
   * entrar de novo com outro char é correção, não uma segunda presença. Ninguém
   * raida em dois ao mesmo tempo, e duas linhas fariam a mesma pessoa aparecer
   * duas vezes na lista de cada peça.
   */
  async entrar(dados: {
    sessionId: string;
    personagem: { nameKey: string; realmKey: string; name: string; realm: string };
    ator: Ator;
  }): Promise<void> {
    const { sessionId, personagem, ator } = dados;
    const characterId = await this.exigirIdentidade(personagem);

    await this.prisma.$transaction([
      this.prisma.lootSessionParticipant.upsert({
        where: { sessionId_userId: { sessionId, userId: ator.userId } },
        create: { sessionId, userId: ator.userId, battletag: ator.battletag, characterId },
        update: { characterId },
      }),
      this.registrarEvento(sessionId, 'participante_entrou', ator, {
        personagem: `${personagem.name}-${personagem.realm}`,
      }),
    ]);
  }

  /** Quem está na sessão. Ordenado por chegada, que é como a raid encheu. */
  async findParticipantes(sessionId: string) {
    const linhas = await this.prisma.lootSessionParticipant.findMany({
      where: { sessionId },
      orderBy: { joinedAt: 'asc' },
      select: {
        userId: true,
        battletag: true,
        joinedAt: true,
        character: { select: characterSelect },
      },
    });

    return linhas.map((l) => ({
      userId: l.userId,
      battletag: l.battletag,
      joinedAt: l.joinedAt,
      characterId: l.character.id,
      nameKey: l.character.nameKey,
      realmKey: l.character.realmKey,
      name: l.character.name,
      realm: l.character.realm,
    }));
  }

  /**
   * Registra o silêncio de quem estava na sessão e não respondeu.
   *
   * Roda quando a fase de roll fecha. **Sem roll**: quem não respondeu nunca
   * rolou, e zero apareceria ao lado de quem tirou 1 parecendo roll ruim.
   *
   * `skipDuplicates` em vez de conferir antes: a checagem e a inserção não são
   * atômicas, e alguém respondendo no exato instante da transição criaria a
   * linha entre uma e outra. O `UNIQUE` decide, e a resposta de verdade ganha.
   *
   * Materializa em vez de derivar na leitura porque a participação continua
   * mudando depois: quem entra durante a deliberação não estava em silêncio na
   * fase de roll, e daqui a um mês não haveria como saber quem estava.
   */
  async registrarSilencio(sessionId: string, ator: Ator): Promise<number> {
    const [itens, participantes, respostas] = await Promise.all([
      this.prisma.lootSessionItem.findMany({ where: { sessionId }, select: { id: true } }),
      this.findParticipantes(sessionId),
      this.prisma.lootSessionResponse.findMany({
        where: { item: { sessionId } },
        select: { itemId: true, characterId: true },
      }),
    ]);

    const respondeu = new Set(respostas.map((r) => `${r.itemId}|${r.characterId}`));

    const silencios = itens.flatMap((item) =>
      participantes
        .filter((p) => !respondeu.has(`${item.id}|${p.characterId}`))
        .map((p) => ({
          itemId: item.id,
          characterId: p.characterId,
          userId: p.userId,
          responseOptionSlug: LOOT_RESPONSES.NOOP,
          roll: null,
          note: null,
        })),
    );

    if (silencios.length === 0) return 0;

    const { count } = await this.prisma.lootSessionResponse.createMany({
      data: silencios,
      skipDuplicates: true,
    });

    await this.prisma.lootSessionEvent.create({
      data: {
        sessionId,
        type: 'silencio_registrado',
        actorUserId: ator.userId,
        actorBattletag: ator.battletag,
        payload: { linhas: count },
      },
    });

    return count;
  }

  /** As respostas de UM personagem nesta sessão. É o que o jogador pode ver. */
  async findRespostasDoPersonagem(sessionId: string, nameKey: string, realmKey: string) {
    const characterId = await this.exigirIdentidade({ nameKey, realmKey });

    const linhas = await this.prisma.lootSessionResponse.findMany({
      where: { item: { sessionId }, characterId },
      select: {
        itemId: true,
        responseOptionSlug: true,
        roll: true,
        note: true,
        aguardandoNovaResposta: true,
        character: { select: { name: true } },
      },
    });

    return linhas.map((l) => ({
      itemId: l.itemId,
      responseOptionSlug: l.responseOptionSlug,
      roll: l.roll,
      note: l.note,
      aguardandoNovaResposta: l.aguardandoNovaResposta,
      name: l.character.name,
    }));
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

  /**
   * TODAS as respostas da sessão. É o que só o conselho vê.
   *
   * Fica em método separado do `findRespostasDoPersonagem` de propósito: os dois
   * leem a mesma tabela e respondem a perguntas com permissões opostas. Um
   * método só, com um filtro opcional, seria um `if` de distância entre a
   * privacidade da sessão e o vazamento dela.
   */
  async findTodasAsRespostas(sessionId: string) {
    const linhas = await this.prisma.lootSessionResponse.findMany({
      where: { item: { sessionId } },
      select: {
        itemId: true,
        responseOptionSlug: true,
        roll: true,
        note: true,
        aguardandoNovaResposta: true,
        character: { select: characterSelect },
      },
    });

    return linhas.map((l) => ({
      itemId: l.itemId,
      nameKey: l.character.nameKey,
      realmKey: l.character.realmKey,
      name: l.character.name,
      realm: l.character.realm,
      responseOptionSlug: l.responseOptionSlug,
      roll: l.roll,
      note: l.note,
      aguardandoNovaResposta: l.aguardandoNovaResposta,
    }));
  }

  /**
   * O que estes personagens já receberam, do histórico de loot.
   *
   * Uma consulta para TODOS os candidatos da sessão, não uma por pessoa: são até
   * ~26 numa noite, e N+1 aqui seria 26 idas ao banco a cada abertura do painel
   * — que a tela vai reabrir a cada voto.
   *
   * O corte por quantidade é feito depois, em memória, porque "os N mais
   * recentes POR PESSOA" precisaria de window function e o volume não justifica.
   * O `take` aqui é teto de segurança, não a regra.
   */
  async findHistoricoDosCandidatos(chaves: Array<{ nameKey: string; realmKey: string }>) {
    if (chaves.length === 0) return [];

    const identidades = await this.prisma.character.findMany({
      where: { OR: chaves.map((c) => ({ nameKey: c.nameKey, realmKey: c.realmKey })) },
      select: { id: true, nameKey: true, realmKey: true },
    });
    if (identidades.length === 0) return [];

    const porId = new Map(identidades.map((i) => [i.id, i]));

    const linhas = await this.prisma.lootLine.findMany({
      where: { winnerCharacterId: { in: identidades.map((i) => i.id) } },
      orderBy: { awardedAt: 'desc' },
      take: 500,
      select: {
        winnerCharacterId: true,
        awardedAt: true,
        itemId: true,
        difficulty: true,
        responseOptionSlug: true,
      },
    });

    return linhas.flatMap((l) => {
      const identidade = porId.get(l.winnerCharacterId);
      // Não deveria faltar: veio do `IN` sobre os mesmos ids. Defensivo, para
      // não quebrar o painel se algo mudar embaixo.
      if (!identidade) return [];

      return [
        {
          winnerNameKey: identidade.nameKey,
          winnerRealmKey: identidade.realmKey,
          awardedAt: l.awardedAt,
          itemId: l.itemId,
          difficulty: l.difficulty,
          responseOptionSlug: l.responseOptionSlug,
        },
      ];
    });
  }

  /** Todos os votos da sessão, para contar por candidato. */
  async findVotos(sessionId: string) {
    const linhas = await this.prisma.lootSessionVote.findMany({
      where: { item: { sessionId } },
      select: {
        itemId: true,
        voterUserId: true,
        candidate: { select: { nameKey: true, realmKey: true } },
      },
    });

    return linhas.map((l) => ({
      itemId: l.itemId,
      candidateNameKey: l.candidate.nameKey,
      candidateRealmKey: l.candidate.realmKey,
      voterUserId: l.voterUserId,
    }));
  }

  /**
   * O voto do conselheiro nesta peça.
   *
   * `UNIQUE (item, votante)`: votar de novo TROCA o voto, não acrescenta. A
   * troca fica no log, que é onde "quem mudou o quê" tem resposta.
   */
  async votar(dados: {
    sessionId: string;
    itemId: string;
    candidato: { nameKey: string; realmKey: string };
    ator: Ator;
  }): Promise<void> {
    const { sessionId, itemId, candidato, ator } = dados;
    const candidateCharacterId = await this.exigirIdentidade(candidato);

    await this.prisma.$transaction([
      this.prisma.lootSessionVote.upsert({
        where: { itemId_voterUserId: { itemId, voterUserId: ator.userId } },
        create: {
          itemId,
          candidateCharacterId,
          voterUserId: ator.userId,
          voterBattletag: ator.battletag,
        },
        update: { candidateCharacterId },
      }),
      this.registrarEvento(sessionId, 'voto_dado', ator, {
        itemId,
        candidato: `${candidato.nameKey}-${candidato.realmKey}`,
      }),
    ]);
  }

  /**
   * O conselho pede para alguém responder de novo.
   *
   * Só para quem **já respondeu** — é o que a issue pede: "reanunciar o item de
   * novo", "pedir para votar novamente". Os dois pressupõem uma resposta que
   * existe.
   *
   * Quem nunca respondeu não é caso disto. A tentação era criar a linha aqui,
   * esperando resposta, mas ela exigiria um slug que não existe na tabela de
   * opções (a FK recusaria) e um roll que não é roll. O caminho para essa pessoa
   * é reabrir a SESSÃO — `deliberando → aberta` —, que já existe e devolve a
   * resposta livre para todo mundo.
   *
   * Devolve `false` quando não há resposta a reabrir — inclusive quando o nome
   * digitado nem casa com identidade nenhuma, que é o mesmo "não achei".
   */
  async reabrirResposta(dados: {
    sessionId: string;
    itemId: string;
    personagem: { nameKey: string; realmKey: string; name: string; realm: string };
    ator: Ator;
  }): Promise<boolean> {
    const { sessionId, itemId, personagem, ator } = dados;

    const characterId = await this.idExistente(personagem);
    if (characterId === null) return false;

    const chave = { itemId_characterId: { itemId, characterId } };

    const existe = await this.prisma.lootSessionResponse.findUnique({
      where: chave,
      select: { id: true },
    });
    if (!existe) return false;

    await this.prisma.$transaction([
      this.prisma.lootSessionResponse.update({
        where: chave,
        data: { aguardandoNovaResposta: true },
      }),
      this.registrarEvento(sessionId, 'resposta_reaberta', ator, {
        itemId,
        personagem: `${personagem.name}-${personagem.realm}`,
      }),
    ]);

    return true;
  }

  /** O conselho corrige a resposta de alguém. Não toca no roll. */
  async alterarResposta(dados: {
    sessionId: string;
    itemId: string;
    personagem: { nameKey: string; realmKey: string };
    responseOptionSlug: string;
    ator: Ator;
  }): Promise<boolean> {
    const { sessionId, itemId, personagem, responseOptionSlug, ator } = dados;

    const characterId = await this.idExistente(personagem);
    if (characterId === null) return false;

    const chave = { itemId_characterId: { itemId, characterId } };

    const existe = await this.prisma.lootSessionResponse.findUnique({
      where: chave,
      select: { responseOptionSlug: true },
    });
    if (!existe) return false;

    await this.prisma.$transaction([
      this.prisma.lootSessionResponse.update({
        where: chave,
        // Sem `roll`. Nada mexe no roll depois da primeira resposta.
        data: { responseOptionSlug },
      }),
      this.registrarEvento(sessionId, 'resposta_alterada', ator, {
        itemId,
        personagem: `${personagem.nameKey}-${personagem.realmKey}`,
        de: existe.responseOptionSlug,
        para: responseOptionSlug,
      }),
    ]);

    return true;
  }

  /** Os awards da sessão, para o painel mostrar o que já foi resolvido. */
  async findAwards(sessionId: string) {
    const linhas = await this.prisma.lootSessionAward.findMany({
      where: { item: { sessionId } },
      select: {
        itemId: true,
        responseOptionSlug: true,
        votes: true,
        note: true,
        awardedByBattletag: true,
        awardedAt: true,
        winner: { select: { name: true, realm: true } },
      },
    });

    return linhas.map((l) => ({
      itemId: l.itemId,
      winnerName: l.winner.name,
      winnerRealm: l.winner.realm,
      responseOptionSlug: l.responseOptionSlug,
      votes: l.votes,
      note: l.note,
      awardedByBattletag: l.awardedByBattletag,
      awardedAt: l.awardedAt,
    }));
  }

  /**
   * Entrega a peça.
   *
   * `create`, e não `upsert`: o `@@unique` em `itemId` é a trava de
   * concorrência, e dois conselheiros entregando ao mesmo tempo têm que dar
   * conflito, não sobrescrita silenciosa. Devolve `false` no conflito.
   *
   * A resposta e a contagem de votos entram CONGELADAS: depois do award a
   * resposta ainda pode ser corrigida, e o histórico precisa guardar o que valia
   * quando a decisão foi tomada.
   */
  async awardar(dados: {
    sessionId: string;
    itemId: string;
    vencedor: { nameKey: string; realmKey: string; name: string; realm: string };
    responseOptionSlug: string;
    votes: number;
    note: string | null;
    ator: Ator;
  }): Promise<boolean> {
    const { sessionId, itemId, vencedor, responseOptionSlug, votes, note, ator } = dados;
    const winnerCharacterId = await this.exigirIdentidade(vencedor);

    try {
      await this.prisma.$transaction([
        this.prisma.lootSessionAward.create({
          data: {
            itemId,
            winnerCharacterId,
            responseOptionSlug,
            votes,
            note,
            awardedByUserId: ator.userId,
            awardedByBattletag: ator.battletag,
          },
        }),
        this.registrarEvento(sessionId, 'item_awardado', ator, {
          itemId,
          vencedor: `${vencedor.name}-${vencedor.realm}`,
          responseOptionSlug,
          votes,
          // O texto da nota NÃO vai para o log: ela é editável em lugar nenhum,
          // então a linha do award já é o registro dela. Duplicar aqui criaria
          // duas cópias do mesmo texto de pessoa, em tabelas com propósitos
          // diferentes.
          comNota: note !== null,
        }),
      ]);

      return true;
    } catch (erro: unknown) {
      // P2002 é o unique do item: alguém entregou primeiro. Qualquer outro erro
      // não é conflito e não pode virar "false" silencioso.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return false;
      }
      throw erro;
    }
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
    return this.slugsAtivos('player');
  }

  /** As opções que o jogador vê como botão, na ordem da tela. */
  findOpcoesDoJogador(): Promise<Array<{ slug: string; label: string }>> {
    return this.prisma.lootResponseOption.findMany({
      where: { active: true, kind: 'player' },
      orderBy: { position: 'asc' },
      select: { slug: true, label: true },
    });
  }

  /**
   * As razões que o loot master pode dar a uma entrega: `banking`,
   * `disenchant`, `no_interest`.
   */
  async findRazoesDoLootMaster(): Promise<string[]> {
    return this.slugsAtivos('loot_master');
  }

  /**
   * Os slugs ativos de um tipo.
   *
   * **Sempre por tipo, nunca todos.** Antes esta consulta devolvia a tabela
   * inteira e era o que validava a resposta do jogador — o que deixava alguém
   * declarar `banking`, que é decisão de destino, e depois da TIT-126 deixaria
   * declarar `noop`, que é o registro de não ter respondido. Forjar o próprio
   * silêncio não daria erro nenhum.
   */
  private async slugsAtivos(kind: LootResponseKind): Promise<string[]> {
    const opcoes = await this.prisma.lootResponseOption.findMany({
      where: { active: true, kind },
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
    const paraCriar = await this.paraCriarItem(item);

    await this.prisma.$transaction([
      this.prisma.lootSessionItem.create({ data: { sessionId, ...paraCriar } }),
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

  /**
   * Normaliza a peça para gravar, resolvendo o looter contra a identidade.
   *
   * O looter vem da colagem do addon — pode ser qualquer personagem da raid,
   * inclusive alguém que nunca logou no site. Por isso `resolver()`, e não
   * `buscarPorChave()`: aqui, ao contrário do resto deste arquivo, a
   * identidade pode não existir ainda. String vazia é "a colagem não disse",
   * herdada do formato antigo — vira `null`, não uma identidade vazia.
   */
  private async paraCriarItem(item: ItemDaSessao): Promise<{
    position: number;
    itemId: number;
    itemString: string;
    looterCharacterId: string | null;
  }> {
    const looterCharacterId =
      item.looterName === ''
        ? null
        : await this.characters.resolver({ name: item.looterName, realm: item.looterRealm });

    return {
      position: item.position,
      itemId: item.itemId,
      itemString: item.itemString,
      looterCharacterId,
    };
  }

  /**
   * A identidade já existente desta pessoa. Nunca cria: por aqui só passa
   * quem já entrou na sessão ou já respondeu antes — a identidade já existe
   * desde o login (Regra 4) ou desde a primeira ação nesta sessão.
   *
   * Lança se não achar: diferente do looter da colagem, chegar aqui sem
   * identidade é estado que a validação do serviço já deveria ter barrado, não
   * um "não encontrado" de negócio.
   */
  private async exigirIdentidade(chave: { nameKey: string; realmKey: string }): Promise<string> {
    const id = await this.idExistente(chave);
    if (id === null) {
      throw new Error(`identidade ${chave.nameKey}/${chave.realmKey} deveria existir e não existe`);
    }
    return id;
  }

  /**
   * A identidade desta pessoa, se existir. Nunca cria.
   *
   * Usado onde o nome vem digitado à mão pelo conselho (reabrir/alterar
   * resposta): typo aqui é "não achei a resposta", não motivo para inventar
   * uma identidade nova.
   */
  private async idExistente(chave: { nameKey: string; realmKey: string }): Promise<string | null> {
    const identidade = await this.characters.buscarPorChave(chave);
    return identidade?.id ?? null;
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
