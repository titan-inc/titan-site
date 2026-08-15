import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  parseItemString,
  parseSessionPaste,
  podeEditarItens,
  podeTransicionar,
  type AddLootSessionItem,
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

    return { session: await this.detalhe(id), problemas: colagem.problemas };
  }

  async detalhe(id: string): Promise<LootSessionDetail> {
    const sessao = await this.repo.findById(id);
    if (!sessao) throw new NotFoundException(`Sessão "${id}" não existe`);

    const itens = await this.repo.findItems(sessao.items.map((i) => i.itemId));
    const catalogo = new Map(itens.map((i) => [i.itemId, i]));

    return montarDetalhe(sessao, catalogo);
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

    return this.detalhe(id);
  }

  async removerItem(id: string, itemId: string, ator: Ator): Promise<LootSessionDetail> {
    const sessao = await this.exigirSessao(id);
    this.exigirRascunho(sessao.status, 'remover item');

    const removeu = await this.repo.removerItem(id, itemId, ator);
    if (!removeu) throw new NotFoundException(`Item "${itemId}" não é desta sessão`);

    return this.detalhe(id);
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

    await this.repo.trocarStatus(id, sessao.status, para, ator, sessao.openedAt === null);
    return this.detalhe(id);
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

/** A linha do banco vira a visão da tela, com o catálogo por cima. */
function montarDetalhe(
  sessao: SessionRow,
  catalogo: Map<number, { name: string | null; icon: string | null; equipLoc: string | null }>,
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
    items: sessao.items.map((item) => montarItem(item, catalogo)),
  };
}

function montarItem(
  item: SessionRow['items'][number],
  catalogo: Map<number, { name: string | null; icon: string | null; equipLoc: string | null }>,
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
  };
}
