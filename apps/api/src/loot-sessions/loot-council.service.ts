import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  podeVotar,
  toCharacterKey,
  toRealmMatchKey,
  type AlterarResposta,
  type Candidato,
  type LootCouncilPanel,
  type ReabrirResposta,
  type Votar,
} from '@titan/shared';
import { LootSessionsRepository, type Ator, type SessionRow } from './loot-sessions.repository';

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

    const [respostas, votos] = await Promise.all([
      this.repo.findTodasAsRespostas(sessionId),
      this.repo.findVotos(sessionId),
    ]);

    const contagem = new Map<string, number>();
    const meus = new Set<string>();

    for (const voto of votos) {
      const chave = `${voto.itemId}|${voto.candidateNameKey}|${voto.candidateRealmKey}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      if (voto.voterUserId === ator.userId) meus.add(chave);
    }

    const porItem = new Map<string, Candidato[]>();

    for (const r of respostas) {
      const chave = `${r.itemId}|${r.nameKey}|${r.realmKey}`;
      const lista = porItem.get(r.itemId) ?? [];

      lista.push({
        name: r.name,
        realm: r.realm,
        nameKey: r.nameKey,
        realmKey: r.realmKey,
        responseOptionSlug: r.responseOptionSlug,
        roll: r.roll,
        aguardandoNovaResposta: r.aguardandoNovaResposta,
        votos: contagem.get(chave) ?? 0,
        meuVoto: meus.has(chave),
      });

      porItem.set(r.itemId, lista);
    }

    return {
      sessionId: sessao.id,
      lootMasterBattletag: sessao.createdByBattletag,
      // Todos os itens, inclusive os sem candidato: peça que ninguém quis é
      // informação, e sumir com ela faria o conselho achar que a lista encolheu.
      itens: sessao.items.map((item) => ({
        itemId: item.id,
        candidatos: ordenar(porItem.get(item.id) ?? []),
      })),
    };
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
   * Só se vota em quem se candidatou.
   *
   * Sem isto, um erro de digitação criaria voto para um personagem que não está
   * na disputa — e a contagem apareceria ao lado de ninguém, sem erro nenhum.
   */
  private async exigirCandidato(sessionId: string, itemId: string, dados: Votar): Promise<Alvo> {
    await this.exigirItem(sessionId, itemId);

    const alvo = normalizar(dados.characterName, dados.characterRealm);
    const respostas = await this.repo.findTodasAsRespostas(sessionId);

    const candidatou = respostas.some(
      (r) => r.itemId === itemId && r.nameKey === alvo.nameKey && r.realmKey === alvo.realmKey,
    );
    if (!candidatou) {
      throw new BadRequestException(`${dados.characterName} não está disputando esta peça`);
    }

    return alvo;
  }
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
 * Mais votos primeiro, depois maior roll.
 *
 * É **sugestão de leitura, nunca decisão**: quem escolhe é o conselho. Sistema
 * que decide sozinho a reputação de alguém erra em público, e a liderança para
 * de confiar nele — Regra 7.
 */
function ordenar(candidatos: Candidato[]): Candidato[] {
  return [...candidatos].sort((a, b) => b.votos - a.votos || b.roll - a.roll);
}
