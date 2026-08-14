import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  LOOT_LINE_SOURCES,
  matchLegacyResponse,
  raidDifficultyFromItemString,
  splitNomeRealm,
  toCharacterKey,
  toEncounterMatchKey,
  toRealmMatchKey,
  type RaidDifficultyLevel,
  type RcExport,
  type RcExportRecord,
} from '@titan/shared';
import {
  LootLinesRepository,
  type EncounterRef,
  type LootLineUpsert,
} from './loot-lines.repository';
import { seasonDaEntrega, type SeasonInicio } from './season-da-entrega';

export interface RcImportResult {
  /** Registros no arquivo. */
  lidos: number;

  /** Decisões de conselho gravadas. */
  gravados: number;

  /** Bonus roll e personal loot, descartados de propósito. */
  descartados: number;

  /** Quantas gravadas casaram com um boss do catálogo, e quantas não. */
  bossResolvido: number;
  bossNaoResolvido: number;

  /** Quantas ficaram sem dificuldade — `itemString` sem contexto de raid. */
  semDificuldade: number;

  /**
   * Quantas ficaram sem season.
   *
   * Sinal de que o job de snapshot ainda não criou a linha da season, ou de que
   * o histórico é anterior a toda season conhecida. Não é erro — é lacuna a
   * rederivar depois.
   */
  semSeason: number;
}

/** Um problema que impede o arquivo de entrar, com o registro que o causou. */
interface Problema {
  id: string;
  motivo: string;
}

@Injectable()
export class RcImportService {
  private readonly logger = new Logger(RcImportService.name);

  constructor(private readonly repo: LootLinesRepository) {}

  /**
   * Importa um export do RCLootCouncil.
   *
   * Idempotente: rodar duas vezes atualiza, não duplica. A chave é o campo `id`
   * do RC (`servertime-índice`), único nos 445 registros do arquivo real.
   */
  async importar(arquivo: RcExport): Promise<RcImportResult> {
    const [encounters, slugsValidos, seasons] = await Promise.all([
      this.repo.findEncounters(),
      this.repo.findResponseOptionSlugs(),
      this.repo.findSeasons(),
    ]);

    const bosses = this.indexarBosses(encounters);
    const { linhas, descartados, problemas } = this.traduzir(
      arquivo,
      bosses,
      slugsValidos,
      seasons,
    );

    this.recusarSeHouveProblema(problemas);

    const gravados = await this.repo.upsertMany(linhas);
    const resultado = this.montarResultado(arquivo.length, linhas, gravados, descartados);

    this.logger.log(
      `import_rc: ${resultado.gravados} gravados, ${resultado.descartados} descartados, ` +
        `${resultado.bossNaoResolvido} sem boss, ${resultado.semDificuldade} sem dificuldade, ` +
        `${resultado.semSeason} sem season`,
    );
    return resultado;
  }

  /**
   * Nome do boss → id do catálogo, pela chave que tolera pontuação.
   *
   * `toEncounterMatchKey()` porque as fontes divergem na pontuação do nome:
   * `Chimaerus the Undreamt God` no Encounter Journal e `Chimaerus, the Undreamt
   * God` no Warcraft Logs. Uma vírgula já reprovou uma carga inteira antes.
   *
   * Chave repetida vira `null` em vez de escolher um dos dois: boss ambíguo é
   * "não sei", e a linha guarda o nome cru para alguém resolver depois.
   */
  private indexarBosses(encounters: EncounterRef[]): Map<string, string | null> {
    const porChave = new Map<string, string | null>();

    for (const encounter of encounters) {
      const chave = toEncounterMatchKey(encounter.name);
      porChave.set(chave, porChave.has(chave) ? null : encounter.id);
    }

    return porChave;
  }

  /** Percorre o arquivo uma vez, separando o que grava do que descarta. */
  private traduzir(
    arquivo: RcExport,
    bosses: Map<string, string | null>,
    slugsValidos: string[],
    seasons: readonly SeasonInicio[],
  ): { linhas: LootLineUpsert[]; descartados: number; problemas: Problema[] } {
    const conhecidos = new Set(slugsValidos);
    const linhas: LootLineUpsert[] = [];
    const problemas: Problema[] = [];
    let descartados = 0;

    for (const registro of arquivo) {
      const resposta = matchLegacyResponse(registro.responseID, registro.response);

      if (resposta.kind === 'desconhecida') {
        problemas.push({ id: registro.id, motivo: `resposta não mapeada: ${resposta.chave}` });
        continue;
      }
      if (resposta.kind === 'ignorada') {
        descartados += 1;
        continue;
      }
      if (!conhecidos.has(resposta.response)) {
        problemas.push({
          id: registro.id,
          motivo: `opção "${resposta.response}" não existe em LootResponseOption`,
        });
        continue;
      }

      const linha = this.montarLinha(registro, resposta.response, bosses, seasons);
      if (linha === null) {
        problemas.push({ id: registro.id, motivo: 'não deu para separar nome e realm' });
        continue;
      }

      linhas.push(linha);
    }

    return { linhas, descartados, problemas };
  }

  /** Um registro do export vira uma linha, campo a campo. */
  private montarLinha(
    registro: RcExportRecord,
    responseOptionSlug: string,
    bosses: Map<string, string | null>,
    seasons: readonly SeasonInicio[],
  ): LootLineUpsert | null {
    const vencedor = splitNomeRealm(registro.player);
    if (vencedor === null) return null;

    // Quem lootou pode ser a mesma pessoa; nulo só quando não dá para ler.
    const lootador = splitNomeRealm(registro.owner);

    const awardedAt = new Date(Number(registro.servertime) * 1_000);

    return {
      source: LOOT_LINE_SOURCES.IMPORT_RC,
      externalId: registro.id,
      awardedAt,

      // Pela data da entrega, não pelo tier da peça — ver `seasonDaEntrega`.
      // Nulo aqui é lacuna: se o job de snapshot ainda não criou a linha da
      // season, rederivar depois é melhor que gravar a season errada agora.
      seasonId: seasonDaEntrega(awardedAt, seasons),

      winnerNameKey: toCharacterKey(vencedor.name),
      winnerRealmKey: toRealmMatchKey(vencedor.realm),
      winnerName: vencedor.name,
      winnerRealm: vencedor.realm,
      winnerClass: registro.class === '' ? null : registro.class,

      looterNameKey: lootador && toCharacterKey(lootador.name),
      looterRealmKey: lootador && toRealmMatchKey(lootador.realm),
      looterName: lootador?.name ?? null,
      looterRealm: lootador?.realm ?? null,

      itemId: registro.itemID,
      itemString: registro.itemString,

      rawInstance: registro.instance,
      rawBoss: registro.boss,
      encounterId: this.resolverBoss(registro.boss, bosses),
      difficulty: this.resolverDificuldade(registro.itemString),

      responseOptionSlug,
      rawResponse: registro.response,
      rawResponseId: registro.responseID,

      votes: registro.votes ?? null,
      note: registro.note === '' ? null : registro.note,
      rawReplacedGear: [registro.gear1, registro.gear2].filter((g) => g !== ''),
    };
  }

  /**
   * O boss do catálogo, quando o nome casa.
   *
   * Não casa em 22% do histórico, e isso é esperado, não erro: o `boss` vem no
   * idioma do cliente de quem era loot master, e 56 registros trazem `Unknown` ou
   * `Desconhecido`. Nulo aqui é "não deu para identificar" — o `rawBoss` fica
   * gravado para o dia em que alguém mapear os nomes traduzidos.
   */
  private resolverBoss(rawBoss: string, bosses: Map<string, string | null>): string | null {
    if (rawBoss === '') return null;
    return bosses.get(toEncounterMatchKey(rawBoss)) ?? null;
  }

  /**
   * A dificuldade **da peça**, do `itemContext`, nunca do sufixo da instância.
   *
   * O sufixo diz onde as pessoas estavam; o contexto diz de onde a peça veio, e é
   * ele que é fato — peça mítica tradeável só existe se caiu no mítico. Os dois
   * divergem em 20 dos 294 registros de conselho, e é legítimo: farm heroico
   * distribuído já dentro do mítico enquanto o grupo alinhava estratégia.
   */
  private resolverDificuldade(itemString: string): RaidDifficultyLevel | null {
    return raidDifficultyFromItemString(itemString);
  }

  /**
   * Recusa o arquivo inteiro, listando TODOS os problemas de uma vez.
   *
   * Não é preciosismo: sem isso, corrigir um rótulo novo exige uma execução por
   * rótulo. Mesma escolha do `matchLegacyResponse`, que devolve `desconhecida` em
   * vez de lançar justamente para o arquivo inteiro ser varrido antes de parar.
   *
   * E é recusa, não descarte: rótulo que ninguém mapeou é lacuna, e gravar o
   * resto em silêncio esconderia que faltou histórico.
   */
  private recusarSeHouveProblema(problemas: Problema[]): void {
    if (problemas.length === 0) return;

    const amostra = problemas.slice(0, 20).map((p) => `${p.id}: ${p.motivo}`);
    const resto = problemas.length - amostra.length;

    throw new BadRequestException({
      message: `${problemas.length} registros impedem o import`,
      problemas: amostra,
      ...(resto > 0 && { eMais: resto }),
    });
  }

  private montarResultado(
    lidos: number,
    linhas: LootLineUpsert[],
    gravados: number,
    descartados: number,
  ): RcImportResult {
    const bossResolvido = linhas.filter((l) => l.encounterId !== null).length;
    const semDificuldade = linhas.filter((l) => l.difficulty === null).length;
    const semSeason = linhas.filter((l) => l.seasonId === null).length;

    return {
      lidos,
      gravados,
      descartados,
      bossResolvido,
      bossNaoResolvido: linhas.length - bossResolvido,
      semDificuldade,
      semSeason,
    };
  }
}
