import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LOOT_RESPONSES,
  podeVotar,
  respostasVisiveis,
  toCharacterKey,
  toRealmMatchKey,
  type AlterarResposta,
  type AwardEmMassaResultado,
  type Awardar,
  type PassItemTo,
  type AwardPorMaioria,
  type Candidato,
  type LootCouncilPanel,
  type ReabrirResposta,
  type RecebidoAntes,
  type Votar,
} from '@titan/shared';
import { LootSessionsRepository, type Ator, type SessionRow } from './loot-sessions.repository';

/**
 * Quantas peças anteriores o painel mostra por candidato.
 *
 * Cinco porque é o que cabe ao lado de um nome sem virar tabela — e porque o
 * conselho decide com o recente, não com a season inteira. Quem quer tudo abre
 * a aba de Histórico.
 */
const RECEBIDOS_NO_PAINEL = 5;

/** O alvo de uma ação do conselho, já normalizado — Regra 6. */
interface Alvo {
  nameKey: string;
  realmKey: string;
  name: string;
  realm: string;
}

/**
 * O painel do conselho: a metade de cima da tela da sessão.
 *
 * Serviço separado do `LootSessionsService` de propósito. Os dois leem a mesma
 * sessão, mas com permissões opostas — um responde "o que eu vejo", o outro "o
 * que quem decide vê". Misturar os dois num serviço só deixaria a diferença a um
 * `if` de distância, e é diferença que não pode depender de ninguém lembrar.
 */
@Injectable()
export class LootCouncilService {
  constructor(private readonly repo: LootSessionsRepository) {}

  /**
   * Todas as respostas, com os votos por candidato.
   *
   * Três consultas: a sessão, as respostas e os votos. Nada de N+1 por item —
   * uma sessão tem 3 a 5 peças e ~26 pessoas, então tudo cabe na memória e a
   * junção sai daqui.
   */
  async painel(sessionId: string, ator: Ator): Promise<LootCouncilPanel> {
    const sessao = await this.exigirSessao(sessionId);

    const porItem = await this.painelBase(sessao, ator.userId);
    const awards = new Map((await this.repo.findAwards(sessionId)).map((a) => [a.itemId, a]));

    return {
      sessionId: sessao.id,
      lootMasterBattletag: sessao.createdByBattletag,
      // Todos os itens, inclusive os sem candidato: peça que ninguém quis é
      // informação, e sumir com ela faria o conselho achar que a lista encolheu.
      itens: sessao.items.map((item) => {
        const award = awards.get(item.id);

        return {
          itemId: item.id,
          candidatos: porItem.get(item.id) ?? [],
          award: award
            ? {
                winnerName: award.winnerName,
                winnerRealm: award.winnerRealm,
                responseOptionSlug: award.responseOptionSlug,
                votes: award.votes,
                awardedByBattletag: award.awardedByBattletag,
                awardedAt: award.awardedAt.toISOString(),
                note: award.note,
              }
            : null,
        };
      }),
    };
  }

  /**
   * As pessoas de cada peça, já ordenadas.
   *
   * Extraído porque o award por maioria precisa exatamente da mesma visão que a
   * tela mostra. Se ele recalculasse por conta própria, o conselho poderia ver
   * uma ordem e o botão entregar para outra pessoa — e ninguém receberia erro.
   *
   * `atorUserId` só existe para marcar `meuVoto`; o award não precisa dele.
   */
  private async painelBase(
    sessao: SessionRow,
    atorUserId?: string,
  ): Promise<Map<string, Candidato[]>> {
    const [respostas, votos, participantes] = await Promise.all([
      this.repo.findTodasAsRespostas(sessao.id),
      this.repo.findVotos(sessao.id),
      this.repo.findParticipantes(sessao.id),
    ]);

    // Todo participante entra em toda peça, tenha respondido ou não. Mostrar só
    // quem respondeu faria a lista parecer menor que a raid, e quem decide
    // precisa saber que perguntou a 25 e 6 não disseram nada.
    const linhas = comSilenciosos(
      sessao.items.map((i) => i.id),
      respostas,
      participantes,
    );

    const historico = await this.montarHistorico(linhas);

    const contagem = new Map<string, number>();
    const meus = new Set<string>();

    for (const voto of votos) {
      const chave = `${voto.itemId}|${voto.candidateNameKey}|${voto.candidateRealmKey}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      if (voto.voterUserId === atorUserId) meus.add(chave);
    }

    // Na fase de roll o conselho vê QUEM respondeu, e mais nada — conselheiro
    // também é candidato, e escolha alheia na hora de declarar muda o que ele
    // declara, igual a qualquer um. Ver TIT-131.
    const aberto = respostasVisiveis(sessao.status);

    const porItem = new Map<string, Candidato[]>();

    for (const r of linhas) {
      const chave = `${r.itemId}|${r.nameKey}|${r.realmKey}`;
      const lista = porItem.get(r.itemId) ?? [];

      lista.push({
        name: r.name,
        realm: r.realm,
        nameKey: r.nameKey,
        realmKey: r.realmKey,
        respondeu: r.responseOptionSlug !== null,
        responseOptionSlug: aberto ? r.responseOptionSlug : null,
        roll: aberto ? r.roll : null,
        note: aberto ? r.note : null,
        aguardandoNovaResposta: r.aguardandoNovaResposta,
        votos: contagem.get(chave) ?? 0,
        meuVoto: meus.has(chave),
        recebidoAntes: historico.get(`${r.nameKey}|${r.realmKey}`) ?? [],
      });

      porItem.set(r.itemId, lista);
    }

    for (const [itemId, lista] of porItem) porItem.set(itemId, ordenar(lista));
    return porItem;
  }

  /**
   * O que cada candidato já recebeu — o contexto que resolve votar cego.
   *
   * Duas consultas para a sessão inteira: o histórico de todos os candidatos, e
   * os itens do catálogo que ele referencia. Nada por pessoa; a tela reabre o
   * painel a cada voto, e N+1 aqui seriam 26 idas ao banco por clique.
   *
   * **Não é o explorador.** São as últimas peças de cada um, e mais nada — o
   * recorte que o ato de decidir justifica. Quem quer o histórico inteiro abre a
   * aba de Histórico, que é aberta a todo mundo da área interna.
   */
  private async montarHistorico(
    respostas: Array<{ nameKey: string; realmKey: string }>,
  ): Promise<Map<string, RecebidoAntes[]>> {
    const chaves = [
      ...new Map(respostas.map((r) => [`${r.nameKey}|${r.realmKey}`, r])).values(),
    ].map((r) => ({ nameKey: r.nameKey, realmKey: r.realmKey }));

    const linhas = await this.repo.findHistoricoDosCandidatos(chaves);
    if (linhas.length === 0) return new Map();

    const itens = await this.repo.findItems([...new Set(linhas.map((l) => l.itemId))]);
    const catalogo = new Map(itens.map((i) => [i.itemId, i]));

    const porPessoa = new Map<string, RecebidoAntes[]>();

    // As linhas já vêm mais recentes primeiro, então o corte por pessoa é só
    // parar de acrescentar depois do limite.
    for (const linha of linhas) {
      const chave = `${linha.winnerNameKey}|${linha.winnerRealmKey}`;
      const lista = porPessoa.get(chave) ?? [];
      if (lista.length >= RECEBIDOS_NO_PAINEL) continue;

      const item = catalogo.get(linha.itemId);
      lista.push({
        awardedAt: linha.awardedAt.toISOString(),
        // Do catálogo, nunca do que a fonte gravou: o `itemName` importado vem
        // no idioma do cliente de quem era loot master (TIT-49).
        itemName: item?.name ?? null,
        icon: item?.icon ?? null,
        equipLoc: item?.equipLoc ?? null,
        difficulty: linha.difficulty,
        responseOptionSlug: linha.responseOptionSlug,
      });

      porPessoa.set(chave, lista);
    }

    return porPessoa;
  }

  /**
   * O voto do conselheiro numa peça.
   *
   * Só em `deliberando`: votar antes de as respostas fecharem seria votar com
   * informação incompleta.
   */
  async votar(sessionId: string, itemId: string, dados: Votar, ator: Ator): Promise<void> {
    const sessao = await this.exigirSessao(sessionId);

    if (!podeVotar(sessao.status)) {
      throw new BadRequestException(
        `A sessão está em "${sessao.status}"; o conselho vota em "deliberando"`,
      );
    }

    const alvo = await this.exigirCandidato(sessionId, itemId, dados);

    // Só a identidade. O `Alvo` carrega a grafia digitada junto, e passar o
    // objeto inteiro mandaria campos que o repositório não declara — eles
    // viajariam em silêncio até alguém confiar neles.
    await this.repo.votar({
      sessionId,
      itemId,
      candidato: { nameKey: alvo.nameKey, realmKey: alvo.realmKey },
      ator,
    });
  }

  /**
   * O conselho pede para alguém responder de novo.
   *
   * É o que destrava a deliberação: desde a TIT-65, resposta em `deliberando` só
   * entra para quem foi reaberto.
   *
   * Só funciona para quem já respondeu. Trazer para a disputa quem não respondeu
   * é reabrir a sessão inteira (`deliberando → aberta`) — ver o repositório.
   */
  async reabrirResposta(
    sessionId: string,
    itemId: string,
    dados: ReabrirResposta,
    ator: Ator,
  ): Promise<void> {
    await this.exigirSessao(sessionId);
    await this.exigirItem(sessionId, itemId);

    const reabriu = await this.repo.reabrirResposta({
      sessionId,
      itemId,
      personagem: normalizar(dados.characterName, dados.characterRealm),
      ator,
    });

    if (!reabriu) {
      throw new NotFoundException(
        `${dados.characterName} não respondeu a esta peça. ` +
          'Para trazer quem não respondeu, reabra a sessão inteira.',
      );
    }
  }

  /**
   * O conselho corrige a resposta de alguém.
   *
   * Vira evento `resposta_alterada`, separado de `resposta_dada`: "o que eu
   * declarei" e "o que mudaram no que eu declarei" são perguntas diferentes, e a
   * segunda é a que a issue diz que precisa ter resposta.
   */
  async alterarResposta(
    sessionId: string,
    itemId: string,
    dados: AlterarResposta,
    ator: Ator,
  ): Promise<void> {
    await this.exigirSessao(sessionId);
    await this.exigirItem(sessionId, itemId);

    const ativos = await this.repo.findSlugsAtivos();
    if (!ativos.includes(dados.responseOptionSlug)) {
      throw new BadRequestException(
        `"${dados.responseOptionSlug}" não é uma opção de resposta ativa`,
      );
    }

    const alterou = await this.repo.alterarResposta({
      sessionId,
      itemId,
      personagem: normalizar(dados.characterName, dados.characterRealm),
      responseOptionSlug: dados.responseOptionSlug,
      ator,
    });

    if (!alterou) {
      throw new NotFoundException(`${dados.characterName} não respondeu a esta peça`);
    }
  }

  /**
   * O conselho entrega a peça a uma pessoa específica.
   *
   * Só a quem se candidatou: entregar a quem não pediu inverteria o que a sessão
   * registra. Se a pessoa deveria estar na disputa e não está, o caminho é
   * reabrir a resposta dela.
   */
  async awardar(sessionId: string, itemId: string, dados: Awardar, ator: Ator): Promise<void> {
    const sessao = await this.exigirSessao(sessionId);
    this.exigirDeliberando(sessao.status);

    const alvo = await this.exigirCandidato(sessionId, itemId, dados);
    const candidatos = await this.candidatosDoItem(sessao, itemId);
    const escolhido = candidatos.find(
      (c) => c.nameKey === alvo.nameKey && c.realmKey === alvo.realmKey,
    );
    if (!escolhido) throw new BadRequestException(`${dados.characterName} não está na disputa`);

    await this.gravarAward(sessionId, itemId, escolhido, ator, dados.note ?? null);
  }

  /**
   * A peça vai para alguém por decisão do loot master, não por interesse.
   *
   * Rota própria, e não um campo do award, porque as validações são **opostas**:
   * ali só quem se candidatou, e congela a declaração dela; aqui qualquer
   * participante, e congela a razão de quem entregou. As duas gravam a mesma
   * linha, pelo mesmo método privado.
   *
   * É a saída da peça que ninguém pediu. Sem ela a sessão trava: entrega sem
   * voto não sai sozinha, e peça sem dono segura o encerramento.
   */
  async passItemTo(
    sessionId: string,
    itemId: string,
    dados: PassItemTo,
    ator: Ator,
  ): Promise<void> {
    const sessao = await this.exigirSessao(sessionId);
    this.exigirDeliberando(sessao.status);
    await this.exigirItem(sessionId, itemId);

    const razoes = await this.repo.findRazoesDoLootMaster();
    if (!razoes.includes(dados.responseOptionSlug)) {
      throw new BadRequestException(
        `"${dados.responseOptionSlug}" não é uma razão de loot master. ` +
          `Use uma de: ${razoes.join(', ')}.`,
      );
    }

    const destino = await this.exigirParticipante(sessionId, dados);

    await this.gravarAward(
      sessionId,
      itemId,
      {
        ...destino,
        // A razão do loot master ocupa o lugar da declaração, porque é ela que
        // responde "o que foi esta entrega". Sem voto: não houve votação, e
        // zero aqui é resultado, não lacuna.
        responseOptionSlug: dados.responseOptionSlug,
        respondeu: false,
        roll: null,
        // A nota do loot master vai na entrega, não aqui: esta é a do jogador,
        // e ele não declarou nada.
        note: null,
        aguardandoNovaResposta: false,
        votos: 0,
        meuVoto: false,
        recebidoAntes: [],
      },
      ator,
      dados.note ?? null,
    );
  }

  /**
   * Entrega por maioria: a peça vai para quem tem mais votos.
   *
   * Com `itemId`, uma peça; sem, todas as que ainda não foram entregues. É a
   * mesma regra aplicada a um ou a todos — duas implementações duplicariam o
   * desempate, que é a parte delicada.
   */
  async awardarPorMaioria(
    sessionId: string,
    dados: AwardPorMaioria,
    ator: Ator,
  ): Promise<AwardEmMassaResultado> {
    const sessao = await this.exigirSessao(sessionId);
    this.exigirDeliberando(sessao.status);

    const alvos = dados.itemId ? [dados.itemId] : sessao.items.map((i) => i.id);
    if (dados.itemId) await this.exigirItem(sessionId, dados.itemId);

    const jaEntregues = new Set((await this.repo.findAwards(sessionId)).map((a) => a.itemId));

    // Uma leitura só para a sessão inteira: entregar uma peça não muda resposta
    // nem voto de outra, então recalcular por item seriam quatro consultas
    // vezes o número de peças, para chegar sempre no mesmo lugar.
    const porItem = await this.painelBase(sessao);

    const pulados: AwardEmMassaResultado['pulados'] = [];
    let entregues = 0;

    for (const alvo of alvos) {
      if (jaEntregues.has(alvo)) {
        pulados.push({ itemId: alvo, motivo: 'já entregue' });
        continue;
      }

      const vencedor = escolherPorMaioria(porItem.get(alvo) ?? []);

      if (typeof vencedor === 'string') {
        pulados.push({ itemId: alvo, motivo: vencedor });
        continue;
      }

      await this.gravarAward(sessionId, alvo, vencedor, ator, null);
      entregues += 1;
    }

    return { entregues, pulados };
  }

  private async gravarAward(
    sessionId: string,
    itemId: string,
    vencedor: Candidato,
    ator: Ator,
    note: string | null,
  ): Promise<void> {
    // Quem não declarou nada não tem o que congelar, e `exigirCandidato()` já
    // barrou antes de chegar aqui. Entregar a quem não pediu é a TIT-127, e lá
    // o que congela é a razão do loot master — não uma declaração que não houve.
    const { responseOptionSlug } = vencedor;
    if (responseOptionSlug === null) {
      throw new BadRequestException(`${vencedor.name} não declarou nada para esta peça`);
    }

    const gravou = await this.repo.awardar({
      sessionId,
      itemId,
      vencedor: {
        nameKey: vencedor.nameKey,
        realmKey: vencedor.realmKey,
        name: vencedor.name,
        realm: vencedor.realm,
      },
      // Congelados: depois do award a resposta ainda pode ser corrigida, e o
      // histórico guarda o que valia quando a decisão foi tomada.
      responseOptionSlug,
      votes: vencedor.votos,
      note,
      ator,
    });

    if (!gravou) {
      throw new ConflictException('Esta peça já foi entregue por outro conselheiro');
    }
  }

  /** Os candidatos de uma peça, com voto e roll — a mesma visão do painel. */
  private async candidatosDoItem(sessao: SessionRow, itemId: string): Promise<Candidato[]> {
    return (await this.painelBase(sessao)).get(itemId) ?? [];
  }

  private exigirDeliberando(status: SessionRow['status']): void {
    if (!podeVotar(status)) {
      throw new BadRequestException(
        `A sessão está em "${status}"; o conselho entrega em "deliberando"`,
      );
    }
  }

  private async exigirSessao(sessionId: string): Promise<SessionRow> {
    const sessao = await this.repo.findById(sessionId);
    if (!sessao) throw new NotFoundException(`Sessão "${sessionId}" não existe`);
    return sessao;
  }

  private async exigirItem(sessionId: string, itemId: string): Promise<void> {
    if (!(await this.repo.itemPertence(sessionId, itemId))) {
      throw new NotFoundException(`Item "${itemId}" não é desta sessão`);
    }
  }

  /**
   * O destino de um `pass item to` precisa estar **na sessão**.
   *
   * E o motivo é do jogo, não política nossa: a janela de trade do WoW só existe
   * para quem estava no grupo quando a peça caiu. Entregar a quem não estava
   * seria registrar uma entrega que não pode acontecer — e o histórico ficaria
   * afirmando que ela aconteceu.
   *
   * Vale inclusive para `banking`: quem guarda a peça é alguém que estava na
   * raid, nunca um alt de banco fora do grupo.
   */
  private async exigirParticipante(
    sessionId: string,
    dados: { characterName: string; characterRealm: string },
  ): Promise<Alvo> {
    const alvo = normalizar(dados.characterName, dados.characterRealm);
    const participantes = await this.repo.findParticipantes(sessionId);

    const esta = participantes.some(
      (p) => p.nameKey === alvo.nameKey && p.realmKey === alvo.realmKey,
    );
    if (!esta) {
      throw new BadRequestException(
        `${dados.characterName} não está na sessão. ` +
          'Só dá para passar a peça para quem estava no grupo — é a janela de trade do jogo.',
      );
    }

    return alvo;
  }

  /**
   * Só se vota em quem **declarou interesse**.
   *
   * Sem isto, um erro de digitação criaria voto para um personagem que não está
   * na disputa — e a contagem apareceria ao lado de ninguém, sem erro nenhum.
   *
   * Estar na sessão não basta: desde a TIT-126 todo participante aparece na
   * lista de toda peça, e a maioria deles não pediu nada. Quem não se manifestou
   * é alcançável pelo award à mão e pelo `pass item to`, nunca pelo voto — voto
   * é sobre o que a pessoa declarou querer.
   */
  private async exigirCandidato(sessionId: string, itemId: string, dados: Votar): Promise<Alvo> {
    await this.exigirItem(sessionId, itemId);

    const alvo = normalizar(dados.characterName, dados.characterRealm);
    const respostas = await this.repo.findTodasAsRespostas(sessionId);

    const declarou = respostas.some(
      (r) =>
        r.itemId === itemId &&
        r.nameKey === alvo.nameKey &&
        r.realmKey === alvo.realmKey &&
        r.responseOptionSlug !== LOOT_RESPONSES.NOOP,
    );
    if (!declarou) {
      throw new BadRequestException(`${dados.characterName} não está disputando esta peça`);
    }

    return alvo;
  }
}

/** Uma linha do painel antes de virar `Candidato`: resposta de verdade ou silêncio. */
interface LinhaDoPainel {
  itemId: string;
  nameKey: string;
  realmKey: string;
  name: string;
  realm: string;
  responseOptionSlug: string | null;
  roll: number | null;
  note: string | null;
  aguardandoNovaResposta: boolean;
}

/**
 * Toda peça ganha uma linha por participante, respondendo ou não.
 *
 * Quem não respondeu entra com `responseOptionSlug` nulo — silêncio ainda
 * provisório, com a sessão aberta e a pessoa podendo responder. Quando a fase de
 * roll fecha, o silêncio vira linha de `noop` no banco e passa por aqui como
 * resposta normal; a partir daí o nulo não aparece mais.
 */
function comSilenciosos(
  itens: string[],
  respostas: LinhaDoPainel[],
  participantes: Array<{ nameKey: string; realmKey: string; name: string; realm: string }>,
): LinhaDoPainel[] {
  const jaTem = new Set(respostas.map((r) => `${r.itemId}|${r.nameKey}|${r.realmKey}`));

  const silenciosos = itens.flatMap((itemId) =>
    participantes
      .filter((p) => !jaTem.has(`${itemId}|${p.nameKey}|${p.realmKey}`))
      .map((p) => ({
        itemId,
        nameKey: p.nameKey,
        realmKey: p.realmKey,
        name: p.name,
        realm: p.realm,
        responseOptionSlug: null,
        roll: null,
        note: null,
        aguardandoNovaResposta: false,
      })),
  );

  return [...respostas, ...silenciosos];
}

/** A grafia digitada vira identidade — `toCharacterKey` mantém acento (Regra 6). */
function normalizar(name: string, realm: string): Alvo {
  return {
    nameKey: toCharacterKey(name),
    realmKey: toRealmMatchKey(realm),
    name,
    realm,
  };
}

/**
 * Quem leva a peça pela contagem de votos, ou o motivo de não dar.
 *
 * **Não existe decisão automática.** Uma peça só ganha dono de dois jeitos: o
 * loot master aponta a pessoa à mão, ou a contagem de votos aponta — e a
 * contagem também é decisão do conselho, porque foram conselheiros que votaram.
 * Tudo que não cair num desses dois casos volta como motivo, e a peça espera.
 *
 * **O roll não decide nada.** Ele é auxílio visual, do mesmo tipo que o
 * histórico de peças recebidas: está na tela para o conselho olhar e escolher.
 * Usá-lo para desempatar seria o sistema decidindo a reputação de alguém por
 * critério que a tela apresenta como informação, não como regra — o que a Regra
 * 7 diz que faz a liderança parar de confiar na ferramenta.
 *
 * Por isso **sem voto não sai peça**, nem quando há um candidato só: votar é o
 * trabalho do conselho, e peça sem decisão segura o encerramento da sessão em
 * vez de se resolver sozinha.
 */
function escolherPorMaioria(candidatos: Candidato[]): Candidato | string {
  const [primeiro, segundo] = ordenar(candidatos);

  if (!primeiro) return 'ninguém se candidatou';
  if (primeiro.votos === 0) return 'o conselho ainda não votou nesta peça — escolha à mão';

  if (segundo && segundo.votos === primeiro.votos) {
    return `empate de votos entre ${primeiro.name} e ${segundo.name} — escolha à mão`;
  }

  // O conselho pediu outra resposta a quem está na frente, e ela ainda não veio.
  // Entregar agora congelaria no histórico justamente a resposta de que o
  // conselho duvidou. Item a item continua liberado: ali a escolha é explícita.
  if (primeiro.aguardandoNovaResposta) {
    return `${primeiro.name} está com a resposta reaberta — escolha à mão ou espere a resposta`;
  }

  return primeiro;
}

/**
 * Mais votos primeiro, depois maior roll, e quem não respondeu por último.
 *
 * É **ordem de leitura, nunca decisão** — e o roll entra aqui exatamente por
 * isso: ele existe para o conselho olhar, não para desempatar. Ver
 * `escolherPorMaioria()`, que não o consulta.
 *
 * Sem roll vai para o fim porque é quem não se manifestou: a lista é para
 * decidir, e quem não pediu não disputa. Continua visível — sumir com a linha
 * faria a lista parecer menor que a raid.
 */
function ordenar(candidatos: Candidato[]): Candidato[] {
  return [...candidatos].sort((a, b) => b.votos - a.votos || (b.roll ?? -1) - (a.roll ?? -1));
}
