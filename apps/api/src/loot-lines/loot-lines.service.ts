import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  LOOT_LINE_SOURCES,
  raidDifficultyFromItemString,
  type LootResponseKind,
} from '@titan/shared';
import { LootLinesRepository, type LootLineFromSession } from './loot-lines.repository';
import { seasonDaEntrega, type SeasonInicio } from './season-da-entrega';

/**
 * Uma peça entregue numa sessão, como o `loot-sessions` a monta a partir do
 * award e da resposta do vencedor.
 *
 * `loot-sessions` monta isto e `loot-lines` traduz para `LootLineFromSession`
 * — a mesma divisão de responsabilidade do `RcImportService`: quem tem o dado
 * bruto monta, quem é dona da tabela resolve season/kind e grava.
 */
export interface LinhaDeEncerramento {
  /** `LootSessionItem.id` — a chave que torna a gravação idempotente. */
  externalId: string;

  itemId: number;
  itemString: string;

  winnerCharacterId: string;
  looterCharacterId: string | null;

  responseOptionSlug: string;
  votes: number;

  /** `LootSessionAward.note`. */
  councilNote: string | null;
  /** `LootSessionResponse.note` do vencedor, para este item. */
  playerNote: string | null;

  awardedAt: Date;
  awardedByUserId: string;
  awardedByBattletag: string;
}

@Injectable()
export class LootLinesService {
  constructor(private readonly repo: LootLinesRepository) {}

  /**
   * Grava as linhas do encerramento de uma sessão.
   *
   * `tx` OPCIONAL — ver o comentário de `LootLinesRepository.upsertDaSessao`.
   * Sem ele (a rota de ops que regera o histórico), abre a própria transação;
   * com ele (o encerramento em si), grava DENTRO da transação que
   * `loot-sessions` já abriu, para o status e o histórico commitarem juntos.
   *
   * `encounterId` é o do `LootSession`, não de cada award — é o mesmo boss
   * para toda peça da sessão, então entra uma vez só, fora de `itens`.
   */
  async gravarDaSessao(
    dados: { sessionId: string; encounterId: string | null; itens: LinhaDeEncerramento[] },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const [seasons, opcoes] = await Promise.all([
      this.repo.findSeasons(),
      this.repo.findResponseOptions(),
    ]);
    const responseKindPorSlug = new Map(opcoes.map((o) => [o.slug, o.kind]));

    const linhas = dados.itens.map((item) =>
      this.montarLinha(dados.sessionId, dados.encounterId, item, seasons, responseKindPorSlug),
    );

    return this.repo.upsertDaSessao(linhas, tx);
  }

  /** Um award da sessão vira uma `LootLine`, campo a campo — ver a issue TIT-69. */
  private montarLinha(
    sessionId: string,
    encounterId: string | null,
    item: LinhaDeEncerramento,
    seasons: readonly SeasonInicio[],
    responseKindPorSlug: Map<string, LootResponseKind>,
  ): LootLineFromSession {
    const responseKind = responseKindPorSlug.get(item.responseOptionSlug);
    if (responseKind === undefined) {
      // Não deveria acontecer: o award só existe com um slug que era ativo no
      // momento da entrega, e slug de opção não se apaga (Restrict) — só
      // desativa. Erro de programação, não de dado do usuário.
      throw new Error(`kind não resolvido para a opção "${item.responseOptionSlug}"`);
    }

    return {
      source: LOOT_LINE_SOURCES.LIVE_SESSION,
      externalId: item.externalId,
      sessionId,
      awardedAt: item.awardedAt,
      awardedByUserId: item.awardedByUserId,
      awardedByBattletag: item.awardedByBattletag,

      winnerCharacterId: item.winnerCharacterId,
      looterCharacterId: item.looterCharacterId,

      itemId: item.itemId,
      itemString: item.itemString,

      encounterId,
      // Da PEÇA, nunca da sala onde a sessão aconteceu — as duas divergem
      // legitimamente. Ver o comentário de `raidDifficultyFromItemString`.
      difficulty: raidDifficultyFromItemString(item.itemString),

      // Pela data da entrega, não pelo tier da peça — mesma função que o
      // import usa, mesmo motivo.
      seasonId: seasonDaEntrega(item.awardedAt, seasons),

      responseOptionSlug: item.responseOptionSlug,
      responseKind,

      votes: item.votes,
      playerNote: item.playerNote,
      councilNote: item.councilNote,

      // A sessão ao vivo nasce no nosso formato — nada de fonte externa a
      // preservar.
      rawImportedLine: null,
    };
  }
}
