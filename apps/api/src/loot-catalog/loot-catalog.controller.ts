import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  RAID_DIFFICULTIES,
  raidDifficultyLevelSchema,
  type LootCatalogRaid,
  type LootCatalogRaidSummary,
  type RaidDifficultyLevel,
} from '@titan/shared';
import { MemberGuard } from '../auth/session.guard';
import { LootCatalogService } from './loot-catalog.service';

/**
 * Consulta do catálogo: raid → boss → o que solta em cada dificuldade.
 *
 * `MemberGuard`, e não `OfficerGuard`: loot table de boss é dado do jogo, aberto
 * no Wowhead e no próprio Encounter Journal. Não há o que proteger aqui, e a
 * seção "o corte é filtro de conteúdo, não fronteira de segurança" da Regra 4
 * manda preferir liberar quando o dado já está aberto.
 *
 * O guard existe pela Regra 5 mesmo assim: o proxy do Next é UX, e o teste é
 * "chamado sem cookie devolve 401?".
 *
 * Separado do `/internal/ops/catalog-*`, que é **escrita** por token para
 * automação. Aqui é leitura por sessão de Battle.net — ator diferente, guard
 * diferente, pela Regra 8.
 */
@Controller('internal/loot-catalog')
@UseGuards(MemberGuard)
export class LootCatalogController {
  constructor(private readonly catalog: LootCatalogService) {}

  /**
   * As raids, sem os drops.
   *
   * Sem dificuldade aqui de propósito: filtrar drop numa resposta que não traz
   * drop nenhum não faria nada, e aceitar o parâmetro sugeriria que faz.
   */
  @Get()
  async listRaids(@Query('season') season?: string): Promise<LootCatalogRaidSummary[]> {
    // `async` para o parâmetro inválido virar promise rejeitada, e não throw
    // sincrono: os dois métodos devolvem `Promise`, e falhar de formas diferentes
    // obrigaria quem chama a tratar os dois casos.
    return this.catalog.listRaidSummaries(filtroDeSeason(season));
  }

  /**
   * Uma raid inteira, com os drops.
   *
   * 404 e não lista vazia: slug que não existe é erro de quem chamou, e devolver
   * `[]` faria uma raid não cadastrada parecer uma raid sem loot.
   */
  @Get(':slug')
  async getRaid(
    @Param('slug') slug: string,
    @Query('difficulty') difficulty?: string,
  ): Promise<LootCatalogRaid> {
    const raid = await this.catalog.getRaid(slug, dificuldade(difficulty));

    if (!raid) throw new NotFoundException(`Raid "${slug}" não está no catálogo`);
    return raid;
  }
}

/**
 * `?season=18` → `{ seasonId: 18 }`; ausente → `{}`, que é "todas".
 *
 * Não existe forma de pedir "só as raids sem season", embora o repositório
 * aceite `seasonId: null`: hoje **todas** as quatro estão sem season, porque a
 * `GameSeason` só nasce quando a season começa, então o filtro devolveria a lista
 * inteira. Inventar um token para isso agora seria API para ninguém.
 */
function filtroDeSeason(bruto: string | undefined): { seasonId?: number } {
  if (bruto === undefined || bruto === '') return {};

  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new BadRequestException(`season tem que ser um inteiro positivo, veio "${bruto}"`);
  }

  return { seasonId: valor };
}

/**
 * Valida contra o vocabulário do shared em vez de repassar a string.
 *
 * `?difficulty=mitico` cairia no `where` do Prisma como valor de enum inválido e
 * viraria erro 500 sem dizer o que estava errado. 400 com a lista dos aceitos diz.
 */
function dificuldade(bruto: string | undefined): RaidDifficultyLevel | undefined {
  if (bruto === undefined || bruto === '') return undefined;

  const lido = raidDifficultyLevelSchema.safeParse(bruto);
  if (!lido.success) {
    throw new BadRequestException(
      `difficulty tem que ser um de ${Object.values(RAID_DIFFICULTIES).join(', ')}, veio "${bruto}"`,
    );
  }

  return lido.data;
}
