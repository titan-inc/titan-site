import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  parseItemString,
  parseSessionPaste,
  podeEditarItens,
  respostaLivre,
  respostasVisiveis,
  sessaoAceitaResposta,
  podeTransicionar,
  ROLL_MAXIMO,
  ROLL_MINIMO,
  toCharacterKey,
  toRealmMatchKey,
  type AddLootSessionItem,
  type EntrarNaSessao,
  type Participante,
  type RespostaNaSessao,
  type RespondToLootItem,
  type CreateLootSessionResult,
  type LootSessionDetail,
  type LootSessionItemView,
  type LootSessionStatus,
  type LootSessionSummary,
  type SessionPasteItem,
} from '@titan/shared';
import { LootLinesService } from '../loot-lines/loot-lines.service';
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
  roll: number | null;
  note: string | null;
  aguardandoNovaResposta: boolean;
  name: string;
}

/** A participação como o repositório devolve. */
interface ParticipanteDoBanco {
  userId: string;
  battletag: string;
  nameKey: string;
  realmKey: string;
  name: string;
  realm: string;
  joinedAt: Date;
}

@Injectable()
export class LootSessionsService {
  private readonly logger = new Logger(LootSessionsService.name);

  constructor(
    private readonly repo: LootSessionsRepository,
    private readonly lootLines: LootLinesService,
  ) {}

  /**
   * A colagem do addon vira sessão montada.
   *
   * Lê como pseudo-código: parseia, acha o boss no catálogo, garante que os
   * itens existem no dicionário, grava. Cada passo tem o seu método.
   */
  async criarDaColagem(paste: string, ator: Ator): Promise<CreateLootSessionResult> {
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

    return { session: await this.detalhe(id, ator), problemas: colagem.problemas };
  }

  /**
   * A sessão do ponto de vista de quem está olhando.
   *
   * **Sessão é privada por padrão**: cada pessoa vê a própria resposta e o
   * próprio roll, mais a contagem de quantos já responderam. Ver a resposta
   * alheia durante a deliberação muda o que as pessoas declaram — é exceção
   * consciente à Regra 7, que abre o histórico depois de tudo decidido.
   *
   * Quem não entrou na sessão não tem resposta para ver, e a tela dela é a de
   * entrar — ver `entrar()`.
   */
  async detalhe(id: string, ator: Ator): Promise<LootSessionDetail> {
    const sessao = await this.repo.findById(id);
    if (!sessao) throw new NotFoundException(`Sessão "${id}" não existe`);

    const itens = await this.repo.findItems(sessao.items.map((i) => i.itemId));
    const catalogo = new Map(itens.map((i) => [i.itemId, i]));

    const [totais, participantes, opcoes] = await Promise.all([
      this.repo.contarRespostas(id),
      this.repo.findParticipantes(id),
      this.repo.findOpcoesDoJogador(),
    ]);

    const minha = participantes.find((p) => p.userId === ator.userId) ?? null;
    const minhas = await this.buscarMinhasRespostas(id, minha);
    const todas = await this.buscarRespostasVisiveis(sessao.status, id);

    return montarDetalhe(sessao, catalogo, minhas, totais, participantes, minha, todas, opcoes);
  }

  /**
   * As respostas de todo mundo — **e só depois que a fase de roll fecha**.
   *
   * A consulta é feita ou não conforme a fase; o serviço não devolve a lista
   * para a tela filtrar. Regra 5: o teste não é "a tela esconde?", é "a API
   * devolve?", e um payload com as respostas alheias estaria a um F12 de
   * distância de qualquer pessoa da raid.
   */
  private async buscarRespostasVisiveis(
    status: LootSessionStatus,
    sessionId: string,
  ): Promise<Map<string, RespostaNaSessao[]>> {
    if (!respostasVisiveis(status)) return new Map();

    const porItem = new Map<string, RespostaNaSessao[]>();

    for (const r of await this.repo.findTodasAsRespostas(sessionId)) {
      const lista = porItem.get(r.itemId) ?? [];
      lista.push({
        name: r.name,
        realm: r.realm,
        responseOptionSlug: r.responseOptionSlug,
        roll: r.roll,
        note: r.note,
      });
      porItem.set(r.itemId, lista);
    }

    return porItem;
  }

  /**
   * As respostas do personagem com que a pessoa entrou, indexadas por item.
   *
   * Uma consulta, e não uma por personagem da conta: a participação já disse com
   * qual char a pessoa está nesta noite. Quem não entrou não tem resposta para
   * ver — e a tela dela é a de entrar.
   */
  private async buscarMinhasRespostas(
    sessionId: string,
    participacao: { nameKey: string; realmKey: string } | null,
  ): Promise<Map<string, RespostaDoBanco>> {
    if (!participacao) return new Map();

    const respostas = await this.repo.findRespostasDoPersonagem(
      sessionId,
      participacao.nameKey,
      participacao.realmKey,
    );

    return new Map(respostas.map((r) => [r.itemId, r]));
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

    return this.detalhe(id, ator);
  }

  async removerItem(id: string, itemId: string, ator: Ator): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);
    this.exigirRascunho(sessao.status, 'remover item');

    const removeu = await this.repo.removerItem(id, itemId, ator);
    if (!removeu) throw new NotFoundException(`Item "${itemId}" não é desta sessão`);

    return this.detalhe(id, ator);
  }

  /**
   * Muda o estado da sessão, se a transição existir.
   *
   * Quem decide o que é permitido é `podeTransicionar()` no shared — a mesma
   * função que a tela usa para saber que botão mostrar. Duplicar a regra aqui
   * criaria dois lugares para divergirem.
   */
  async trocarStatus(id: string, para: LootSessionStatus, ator: Ator): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);

    if (!podeTransicionar(sessao.status, para)) {
      throw new BadRequestException(`Não dá para ir de "${sessao.status}" para "${para}"`);
    }
    if (para === 'aberta' && sessao.items.length === 0) {
      throw new BadRequestException('Sessão sem item nenhum não tem o que anunciar');
    }

    if (para === 'encerrada') {
      await this.exigirTudoResolvido(sessao);
      await this.encerrar(sessao, ator);
      return this.detalhe(id, ator);
    }

    await this.repo.trocarStatus(id, sessao.status, para, ator, sessao.openedAt === null);

    // Fechar a fase de roll congela o silêncio de quem estava na sessão. Depois
    // da transição, e não antes: até o último instante alguém ainda podia
    // responder, e a linha de `noop` criada cedo demais seria substituída — mas
    // o log já teria dito que a pessoa não respondeu.
    if (sessao.status === 'aberta' && para === 'deliberando') {
      const silencios = await this.repo.registrarSilencio(id, ator);
      this.logger.log(`sessão ${id}: ${silencios} linhas de silêncio ao fechar as respostas`);
    }

    return this.detalhe(id, ator);
  }

  /**
   * Encerra E grava o histórico na mesma transação — TIT-69.
   *
   * Fora do `repo.trocarStatus` genérico de propósito: é a única transição que
   * precisa atravessar módulo, porque `encerrada` é terminal e uma sessão sem
   * histórico não teria caminho de volta. `exigirTudoResolvido` já rodou antes
   * de chegar aqui.
   */
  private async encerrar(sessao: SessionRow, ator: Ator): Promise<void> {
    const itens = await this.repo.findAwardsParaHistorico(sessao.id);

    const gravadas = await this.repo.encerrarComHistorico(sessao.id, sessao.status, ator, (tx) =>
      this.lootLines.gravarDaSessao(
        { sessionId: sessao.id, encounterId: sessao.encounter?.id ?? null, itens },
        tx,
      ),
    );

    this.logger.log(`sessão ${sessao.id}: encerrada, ${gravadas} linha(s) de histórico gravada(s)`);
  }

  /**
   * Regera as linhas de histórico de uma sessão já encerrada — Regra 8.
   *
   * Rede de segurança para o caso em que `encerrarComHistorico` tenha
   * commitado o status sem gravar (dado de antes desta atomicidade, ou
   * intervenção manual). Segura por construção: `externalId` faz a gravação
   * idempotente, então rodar isto de novo sobre uma sessão já regerada não
   * duplica nada — atualiza as mesmas linhas.
   */
  async regerarHistorico(sessionId: string): Promise<number> {
    const sessao = await this.exigirSessao(sessionId);
    if (sessao.status !== 'encerrada') {
      throw new BadRequestException(`Sessão "${sessionId}" não está encerrada — nada a regerar`);
    }

    const itens = await this.repo.findAwardsParaHistorico(sessionId);
    const gravadas = await this.lootLines.gravarDaSessao({
      sessionId,
      encounterId: sessao.encounter?.id ?? null,
      itens,
    });

    this.logger.log(`sessão ${sessionId}: histórico regerado, ${gravadas} linha(s)`);
    return gravadas;
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

    const personagem = await this.exigirParticipacao(sessionId, ator);
    await this.exigirQuePossaResponderAgora(sessao.status, sessionId, itemId, personagem);

    await this.repo.responder({
      sessionId,
      itemId,
      personagem,
      responseOptionSlug: dados.responseOptionSlug,
      roll: sortearRoll(),
      note: dados.note,
      ator,
    });

    return this.detalhe(sessionId, ator);
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
   * Entra na sessão com um personagem da conta.
   *
   * Ato explícito, e é ele que decide com qual char a pessoa está naquela noite
   * — a resposta herda daqui. Antes cada resposta carregava o personagem e caía
   * no representante da conta quando não vinha; o erro era silencioso, e caía
   * justo em quem raida no alt.
   *
   * Entrar de novo com outro char troca o personagem, e o log guarda a troca.
   */
  async entrar(
    sessionId: string,
    dados: EntrarNaSessao,
    ator: Ator,
    personagens: PersonagemDaConta[],
  ): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(sessionId);

    if (sessao.status === 'encerrada') {
      throw new BadRequestException('A sessão já encerrou');
    }

    const personagem = this.exigirPersonagemDaConta(dados, personagens);
    await this.exigirQuePossaTrocarDePersonagem(sessionId, ator, personagem);

    await this.repo.entrar({ sessionId, personagem, ator });

    return this.detalhe(sessionId, ator);
  }

  /**
   * Trocar de personagem só antes de responder.
   *
   * A resposta guarda o personagem com que foi dada, e a participação é uma por
   * pessoa. Trocar depois de responder deixaria a mesma pessoa em duas linhas do
   * painel — a resposta no char velho e a participação no novo —, e a tela dela
   * diria que não respondeu. Ninguém receberia erro.
   *
   * Entrar pela primeira vez nunca é barrado, e entrar de novo no MESMO
   * personagem também não: repetir o clique não é troca.
   */
  private async exigirQuePossaTrocarDePersonagem(
    sessionId: string,
    ator: Ator,
    novo: { nameKey: string; realmKey: string },
  ): Promise<void> {
    const atual = (await this.repo.findParticipantes(sessionId)).find(
      (p) => p.userId === ator.userId,
    );
    if (!atual) return;
    if (atual.nameKey === novo.nameKey && atual.realmKey === novo.realmKey) return;

    const respostas = await this.repo.findRespostasDoPersonagem(
      sessionId,
      atual.nameKey,
      atual.realmKey,
    );
    if (respostas.length > 0) {
      throw new BadRequestException(
        `Você já respondeu com ${atual.name} nesta sessão. ` +
          'Peça ao conselho para reabrir a resposta antes de trocar de personagem.',
      );
    }
  }

  /**
   * O personagem escolhido **precisa ser da conta**.
   *
   * Aceitar qualquer nome deixaria entrar no lugar de outra pessoa — e daí
   * responder e receber peça no lugar dela.
   */
  private exigirPersonagemDaConta(
    dados: EntrarNaSessao,
    personagens: PersonagemDaConta[],
  ): { nameKey: string; realmKey: string; name: string; realm: string } {
    if (personagens.length === 0) {
      throw new BadRequestException('Sua conta não tem personagem no roster da guilda');
    }

    const escolhido = personagens.find(
      (p) =>
        p.nameKey === toCharacterKey(dados.characterName) &&
        toRealmMatchKey(p.realmSlug) === toRealmMatchKey(dados.characterRealm),
    );

    if (!escolhido) {
      throw new BadRequestException(`"${dados.characterName}" não é um personagem da sua conta`);
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

  /**
   * Quem não entrou não responde.
   *
   * É o que faz o "Entrar" valer alguma coisa: sem isso a participação seria
   * decorativa, e a lista de quem estava na raid não bateria com quem respondeu.
   */
  private async exigirParticipacao(
    sessionId: string,
    ator: Ator,
  ): Promise<{ nameKey: string; realmKey: string; name: string; realm: string }> {
    const minha = (await this.repo.findParticipantes(sessionId)).find(
      (p) => p.userId === ator.userId,
    );

    if (!minha) {
      throw new BadRequestException('Entre na sessão antes de responder');
    }

    return {
      nameKey: minha.nameKey,
      realmKey: minha.realmKey,
      name: minha.name,
      realm: minha.realm,
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
   * Peça que ninguém quis também precisa de dono: `pass` é resposta como
   * qualquer outra, e o que vai para o banco tem `banking`. Não existe "item sem
   * destino" no vocabulário.
   *
   * Segurar aqui é o outro lado de o sistema não decidir nada sozinho: como
   * peça sem voto não sai por conta própria, é este erro que devolve a decisão
   * ao conselho em vez de deixar a sessão fechar com buraco.
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
  participantes: ParticipanteDoBanco[],
  minha: ParticipanteDoBanco | null,
  todas: Map<string, RespostaNaSessao[]>,
  opcoesDeResposta: Array<{ slug: string; label: string }>,
): LootSessionDetail {
  return {
    participantes: participantes.map(paraView),
    minhaParticipacao: minha ? paraView(minha) : null,
    opcoesDeResposta,
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
      montarItem(
        item,
        catalogo,
        minhas.get(item.id) ?? null,
        totais.get(item.id) ?? 0,
        todas.get(item.id) ?? [],
      ),
    ),
  };
}

/** O `userId` não sai daqui: identifica a conta, e a tela fala de personagem. */
function paraView(p: ParticipanteDoBanco): Participante {
  return {
    name: p.name,
    realm: p.realm,
    nameKey: p.nameKey,
    realmKey: p.realmKey,
    battletag: p.battletag,
    joinedAt: p.joinedAt.toISOString(),
  };
}

function montarItem(
  item: SessionRow['items'][number],
  catalogo: Map<number, { name: string | null; icon: string | null; equipLoc: string | null }>,
  minha: RespostaDoBanco | null,
  totalDeRespostas: number,
  respostas: RespostaNaSessao[],
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
    looterName: item.looter?.name ?? null,
    looterRealm: item.looter?.realm ?? null,

    // A própria, sempre. A alheia só entra em `respostas`, e só depois que a
    // fase de roll fecha.
    minhaResposta:
      minha === null
        ? null
        : {
            responseOptionSlug: minha.responseOptionSlug,
            roll: minha.roll,
            note: minha.note,
            aguardandoNovaResposta: minha.aguardandoNovaResposta,
            characterName: minha.name,
          },
    totalDeRespostas,

    // Vazio até as respostas fecharem — quem decide isso é a fase, no serviço.
    respostas,
  };
}
