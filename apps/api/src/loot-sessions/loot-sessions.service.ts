import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  parseItemString,
  parseSessionPaste,
  podeEditarItens,
  respostaLivre,
  sessaoAceitaResposta,
  podeTransicionar,
  ROLL_MAXIMO,
  ROLL_MINIMO,
  toCharacterKey,
  toRealmMatchKey,
  type AddLootSessionItem,
  type RespondToLootItem,
  type CreateLootSessionResult,
  type LootSessionDetail,
  type LootSessionItemView,
  type LootSessionStatus,
  type LootSessionSummary,
  type SessionPasteItem,
} from '@titan/shared';
import {
  LootSessionsRepository,
  type Ator,
  type ItemDaSessao,
  type SessionRow,
} from './loot-sessions.repository';

/** Um personagem da conta de quem está agindo, como o roster o guarda. */
export interface PersonagemDaConta {
  nameKey: string;
  realmSlug: string;
  name: string;
  rank: number;
}

/** A resposta como o repositório devolve. */
interface RespostaDoBanco {
  itemId: string;
  responseOptionSlug: string;
  roll: number;
  aguardandoNovaResposta: boolean;
  name: string;
}

@Injectable()
export class LootSessionsService {
  private readonly logger = new Logger(LootSessionsService.name);

  constructor(private readonly repo: LootSessionsRepository) {}

  /**
   * A colagem do addon vira sessão montada.
   *
   * Lê como pseudo-código: parseia, acha o boss no catálogo, garante que os
   * itens existem no dicionário, grava. Cada passo tem o seu método.
   */
  async criarDaColagem(
    paste: string,
    ator: Ator,
    personagens: PersonagemDaConta[] = [],
  ): Promise<CreateLootSessionResult> {
    const colagem = this.parsear(paste);

    if (colagem.items.length === 0) {
      throw new BadRequestException({
        message: 'A colagem não trouxe item nenhum.',
        problemas: colagem.problemas,
      });
    }

    const encounterId = await this.acharBoss(colagem.encounterId);
    await this.repo.garantirItens(colagem.items.map((i) => i.itemId));

    const id = await this.repo.criar({
      encounterId,
      rawEncounterId: colagem.encounterId,
      rawEncounterName: colagem.encounterName,
      rawInstanceName: colagem.instanceName,
      difficulty: colagem.difficulty,
      ator,
      itens: colagem.items.map((item) => this.paraGravar(item, item.position)),
    });

    this.logger.log(
      `sessão ${id}: ${colagem.items.length} itens, boss ${colagem.encounterId ?? '?'} ` +
        `${encounterId ? 'no catálogo' : 'FORA do catálogo'}, ${colagem.problemas.length} problemas`,
    );

    return { session: await this.detalhe(id, personagens), problemas: colagem.problemas };
  }

  /**
   * A sessão do ponto de vista de quem está olhando.
   *
   * **Sessão é privada por padrão**: cada pessoa vê a própria resposta e o
   * próprio roll, mais a contagem de quantos já responderam. Ver a resposta
   * alheia durante a deliberação muda o que as pessoas declaram — é exceção
   * consciente à Regra 7, que abre o histórico depois de tudo decidido.
   *
   * `personagens` são os da conta de quem pediu. Sem eles — chamada de serviço
   * interna — não vem resposta nenhuma, que é o padrão seguro.
   */
  async detalhe(id: string, personagens: PersonagemDaConta[] = []): Promise<LootSessionDetail> {
    const sessao = await this.repo.findById(id);
    if (!sessao) throw new NotFoundException(`Sessão "${id}" não existe`);

    const itens = await this.repo.findItems(sessao.items.map((i) => i.itemId));
    const catalogo = new Map(itens.map((i) => [i.itemId, i]));

    const totais = await this.repo.contarRespostas(id);
    const minhas = await this.buscarMinhasRespostas(id, personagens);

    return montarDetalhe(sessao, catalogo, minhas, totais);
  }

  /**
   * As respostas dos personagens desta conta, indexadas por item.
   *
   * Busca por TODOS os personagens da conta, e não só o representante: quem
   * raida em dois chars respondeu com um deles, e mostrar "você não respondeu"
   * porque a resposta está no alt faria a pessoa responder duas vezes.
   */
  private async buscarMinhasRespostas(
    sessionId: string,
    personagens: PersonagemDaConta[],
  ): Promise<Map<string, RespostaDoBanco>> {
    const porItem = new Map<string, RespostaDoBanco>();

    for (const personagem of personagens) {
      const respostas = await this.repo.findRespostasDoPersonagem(
        sessionId,
        personagem.nameKey,
        toRealmMatchKey(personagem.realmSlug),
      );

      for (const resposta of respostas) porItem.set(resposta.itemId, resposta);
    }

    return porItem;
  }

  async listarAbertas(): Promise<LootSessionSummary[]> {
    const sessoes = await this.repo.findAbertas();

    return sessoes.map((s) => ({
      id: s.id,
      status: s.status,
      encounterName: s.encounter?.name ?? s.rawEncounterName,
      raidName: s.encounter?.raid.name ?? s.rawInstanceName,
      difficulty: s.difficulty,
      itemCount: s._count.items,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  /**
   * Acrescenta a peça que o addon perdeu.
   *
   * Só em rascunho: depois de a sessão abrir, a lista é o que foi anunciado, e
   * acrescentar item mudaria o que as pessoas já responderam sem elas saberem.
   */
  async adicionarItem(
    id: string,
    dados: AddLootSessionItem,
    ator: Ator,
    personagens: PersonagemDaConta[] = [],
  ): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);
    this.exigirRascunho(sessao.status, 'acrescentar item');

    const lido = parseItemString(dados.itemString);
    if (lido === null) {
      throw new BadRequestException(`Não consegui ler o itemID de "${dados.itemString}"`);
    }

    await this.repo.garantirItens([lido.itemId]);
    await this.repo.adicionarItem(
      id,
      {
        position: await this.repo.proximaPosicao(id),
        itemId: lido.itemId,
        itemString: dados.itemString,
        looterName: dados.looterName ?? '',
        looterRealm: dados.looterRealm ?? '',
      },
      ator,
    );

    return this.detalhe(id, personagens);
  }

  async removerItem(
    id: string,
    itemId: string,
    ator: Ator,
    personagens: PersonagemDaConta[] = [],
  ): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);
    this.exigirRascunho(sessao.status, 'remover item');

    const removeu = await this.repo.removerItem(id, itemId, ator);
    if (!removeu) throw new NotFoundException(`Item "${itemId}" não é desta sessão`);

    return this.detalhe(id, personagens);
  }

  /**
   * Muda o estado da sessão, se a transição existir.
   *
   * Quem decide o que é permitido é `podeTransicionar()` no shared — a mesma
   * função que a tela usa para saber que botão mostrar. Duplicar a regra aqui
   * criaria dois lugares para divergirem.
   */
  async trocarStatus(
    id: string,
    para: LootSessionStatus,
    ator: Ator,
    personagens: PersonagemDaConta[] = [],
  ): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);

    if (!podeTransicionar(sessao.status, para)) {
      throw new BadRequestException(`Não dá para ir de "${sessao.status}" para "${para}"`);
    }
    if (para === 'aberta' && sessao.items.length === 0) {
      throw new BadRequestException('Sessão sem item nenhum não tem o que anunciar');
    }
    if (para === 'encerrada') await this.exigirTudoResolvido(sessao);

    await this.repo.trocarStatus(id, sessao.status, para, ator, sessao.openedAt === null);
    return this.detalhe(id, personagens);
  }

  /**
   * O jogador declara o que quer para uma peça.
   *
   * O roll é gerado aqui, no servidor, **só quando a resposta é a primeira** —
   * quem garante isso é o `upsert` do repositório, que não menciona `roll` no
   * update. Gerar na resposta, e não no início da sessão, resolve de graça três
   * coisas: jogador que entra atrasado, item acrescentado depois, e o incentivo
   * de espiar o número antes de escolher — ele ainda não existe.
   */
  async responder(
    sessionId: string,
    itemId: string,
    dados: RespondToLootItem,
    ator: Ator,
    personagens: PersonagemDaConta[],
  ): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(sessionId);

    if (!sessaoAceitaResposta(sessao.status)) {
      throw new BadRequestException(
        `A sessão está em "${sessao.status}" e não aceita resposta agora`,
      );
    }
    if (!(await this.repo.itemPertence(sessionId, itemId))) {
      throw new NotFoundException(`Item "${itemId}" não é desta sessão`);
    }

    const ativos = await this.repo.findSlugsAtivos();
    if (!ativos.includes(dados.responseOptionSlug)) {
      throw new BadRequestException(
        `"${dados.responseOptionSlug}" não é uma opção de resposta ativa`,
      );
    }

    const personagem = this.escolherPersonagem(dados, personagens);
    await this.exigirQuePossaResponderAgora(sessao.status, sessionId, itemId, personagem);

    await this.repo.responder({
      sessionId,
      itemId,
      personagem,
      responseOptionSlug: dados.responseOptionSlug,
      roll: sortearRoll(),
      ator,
    });

    return this.detalhe(sessionId, personagens);
  }

  /**
   * Em `deliberando`, só responde quem o conselho reabriu.
   *
   * Em `aberta` a resposta é livre — é a fase do roll, e trocar quantas vezes
   * quiser não muda o número. Quando a deliberação começa, a resposta é o que
   * foi declarado: o conselho já está votando em cima dela, e deixar mudar
   * embaixo faria o voto ser sobre uma coisa e a decisão sobre outra.
   *
   * Quem nunca respondeu também é barrado aqui. Trazer essa pessoa de volta é
   * ação do conselho, não dela — e o mecanismo é a TIT-66, que precisa saber
   * criar a reabertura para quem não tem resposta nenhuma ainda.
   */
  private async exigirQuePossaResponderAgora(
    status: LootSessionStatus,
    sessionId: string,
    itemId: string,
    personagem: { nameKey: string; realmKey: string },
  ): Promise<void> {
    if (respostaLivre(status)) return;

    const minhas = await this.repo.findRespostasDoPersonagem(
      sessionId,
      personagem.nameKey,
      personagem.realmKey,
    );
    const desteItem = minhas.find((r) => r.itemId === itemId);

    if (!desteItem?.aguardandoNovaResposta) {
      throw new BadRequestException(
        'As respostas fecharam. Só dá para responder de novo se o conselho pedir.',
      );
    }
  }

  /**
   * Com qual personagem a pessoa está respondendo.
   *
   * Sem escolha explícita, o representante da conta — o de melhor rank, o mesmo
   * que o resto do site usa. Com escolha, ela **precisa ser da conta**: aceitar
   * qualquer nome deixaria responder no lugar de outra pessoa.
   */
  private escolherPersonagem(
    dados: RespondToLootItem,
    personagens: PersonagemDaConta[],
  ): { nameKey: string; realmKey: string; name: string; realm: string } {
    if (personagens.length === 0) {
      throw new BadRequestException('Sua conta não tem personagem no roster da guilda');
    }

    const escolhido =
      dados.characterName === undefined
        ? representante(personagens)
        : personagens.find(
            (p) =>
              p.nameKey === toCharacterKey(dados.characterName ?? '') &&
              (dados.characterRealm === undefined ||
                toRealmMatchKey(p.realmSlug) === toRealmMatchKey(dados.characterRealm)),
          );

    if (!escolhido) {
      throw new BadRequestException(
        `"${dados.characterName ?? ''}" não é um personagem da sua conta`,
      );
    }

    return {
      nameKey: escolhido.nameKey,
      realmKey: toRealmMatchKey(escolhido.realmSlug),
      name: escolhido.name,
      // O roster guarda só o slug do realm, então é ele que sobra para exibir.
      // Reconstruir "Area 52" a partir de "area-52" é adivinhação, e a Regra 6
      // avisa que o caminho de volta é lossy.
      realm: escolhido.realmSlug,
    };
  }

  private parsear(paste: string) {
    try {
      return parseSessionPaste(paste);
    } catch (erro: unknown) {
      // Cabeçalho errado é erro de quem colou, não do servidor: 400, com a
      // mensagem do parser, que já diz o que esperava.
      throw new BadRequestException(erro instanceof Error ? erro.message : 'Colagem inválida');
    }
  }

  /**
   * O boss do catálogo com aquele `dungeonEncounterId`.
   *
   * Nulo é resultado esperado, não erro: o catálogo é cadastro manual e o addon
   * exporta qualquer boss que o grupo matar. A sessão nasce funcionando com o
   * nome cru — mesma tolerância que o histórico importado tem para 26% das
   * linhas dele.
   */
  private async acharBoss(dungeonEncounterId: number | null): Promise<string | null> {
    if (dungeonEncounterId === null) return null;

    const encontrado = await this.repo.findEncounterByDungeonId(dungeonEncounterId);
    return encontrado?.id ?? null;
  }

  /** Normaliza o looter na hora de gravar — Regra 6. */
  private paraGravar(item: SessionPasteItem, position: number): ItemDaSessao {
    return {
      position,
      itemId: item.itemId,
      itemString: item.itemString,
      // Grafia da fonte, para exibir. A normalização (`toCharacterKey` e
      // `toRealmMatchKey`) só entra quando a peça virar linha de loot, no
      // encerramento — aqui o looter é informativo.
      looterName: item.looter?.name ?? '',
      looterRealm: item.looter?.realm ?? '',
    };
  }

  /**
   * Encerrar exige TODO item resolvido.
   *
   * A TIT-62 define isso desde o modelo, e até aqui era só texto: o código
   * deixava encerrar com peça sem dono. Encerrada não volta — dali sai
   * histórico —, então uma peça esquecida viraria buraco permanente, e ninguém
   * receberia erro.
   *
   * Peça que ninguém quis também precisa de dono: `pass` é resposta e ganha no
   * maior roll, e o que vai para o banco tem `banking` como resposta. Não existe
   * "item sem destino" no vocabulário.
   */
  private async exigirTudoResolvido(sessao: SessionRow): Promise<void> {
    const entregues = new Set((await this.repo.findAwards(sessao.id)).map((a) => a.itemId));
    const pendentes = sessao.items.filter((item) => !entregues.has(item.id));

    if (pendentes.length > 0) {
      throw new BadRequestException(
        `${pendentes.length} de ${sessao.items.length} peças ainda não foram entregues. ` +
          'Encerrar é definitivo, e peça sem dono viraria buraco no histórico.',
      );
    }
  }

  private async exigirSessao(id: string): Promise<SessionRow> {
    const sessao = await this.repo.findById(id);
    if (!sessao) throw new NotFoundException(`Sessão "${id}" não existe`);
    return sessao;
  }

  private exigirRascunho(status: LootSessionStatus, acao: string): void {
    if (!podeEditarItens(status)) {
      throw new BadRequestException(
        `Não dá para ${acao} com a sessão em "${status}" — a lista congela quando ela abre`,
      );
    }
  }
}

/**
 * O representante da conta: o de MELHOR rank, que é o MENOR número.
 *
 * Rank 0 é o guild master e o número cresce descendo — em português "rank mais
 * alto" significa o oposto do que significa em código, e é a armadilha que a
 * Regra 4 documenta.
 */
function representante(personagens: PersonagemDaConta[]): PersonagemDaConta | undefined {
  return personagens.reduce<PersonagemDaConta | undefined>(
    (melhor, atual) => (melhor === undefined || atual.rank < melhor.rank ? atual : melhor),
    undefined,
  );
}

/**
 * O roll, de 1 a 100.
 *
 * `randomInt` do `node:crypto`, e não `Math.random()`: o roll decide quem leva
 * item, e mais cedo ou mais tarde alguém vai dizer que o site viciou o sorteio.
 * `Math.random()` não é feito para isso e não teria como ser defendido.
 */
function sortearRoll(): number {
  return randomInt(ROLL_MINIMO, ROLL_MAXIMO + 1);
}

/** A linha do banco vira a visão da tela, com o catálogo por cima. */
function montarDetalhe(
  sessao: SessionRow,
  catalogo: Map<number, { name: string | null; icon: string | null; equipLoc: string | null }>,
  minhas: Map<string, RespostaDoBanco>,
  totais: Map<string, number>,
): LootSessionDetail {
  return {
    id: sessao.id,
    status: sessao.status,
    encounter: {
      encounterId: sessao.encounter?.id ?? null,
      name: sessao.encounter?.name ?? sessao.rawEncounterName,
      raid: sessao.encounter?.raid.name ?? sessao.rawInstanceName,
    },
    difficulty: sessao.difficulty,
    createdByBattletag: sessao.createdByBattletag,
    createdAt: sessao.createdAt.toISOString(),
    openedAt: sessao.openedAt?.toISOString() ?? null,
    items: sessao.items.map((item) =>
      montarItem(item, catalogo, minhas.get(item.id) ?? null, totais.get(item.id) ?? 0),
    ),
  };
}

function montarItem(
  item: SessionRow['items'][number],
  catalogo: Map<number, { name: string | null; icon: string | null; equipLoc: string | null }>,
  minha: RespostaDoBanco | null,
  totalDeRespostas: number,
): LootSessionItemView {
  const doCatalogo = catalogo.get(item.itemId);

  // Derivado na leitura, e não gravado: o `itemString` é a fonte, e guardar uma
  // cópia interpretada criaria duas verdades que podem divergir.
  const lido = parseItemString(item.itemString);

  return {
    id: item.id,
    position: item.position,
    itemId: item.itemId,
    itemString: item.itemString,
    itemContext: lido?.itemContext ?? null,
    bonusIds: lido?.bonusIds ?? [],
    name: doCatalogo?.name ?? null,
    icon: doCatalogo?.icon ?? null,
    equipLoc: doCatalogo?.equipLoc ?? null,
    looterName: item.looterName === '' ? null : item.looterName,
    looterRealm: item.looterRealm === '' ? null : item.looterRealm,

    // Só a própria. A resposta alheia não sai daqui enquanto a sessão corre.
    minhaResposta:
      minha === null
        ? null
        : {
            responseOptionSlug: minha.responseOptionSlug,
            roll: minha.roll,
            aguardandoNovaResposta: minha.aguardandoNovaResposta,
            characterName: minha.name,
          },
    totalDeRespostas,
  };
}
