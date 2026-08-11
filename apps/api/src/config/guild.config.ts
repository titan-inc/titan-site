import { regionSchema, type Region } from '@titan/shared';

/**
 * Identidade da guilda, vinda do ambiente.
 *
 * A guilda é **exclusivamente US**. A região não é escolha de usuário em
 * nenhum ponto do sistema — é este valor, e só.
 *
 * Nada disso é segredo (nome e realm de guilda são públicos no jogo), mas fica
 * em env porque muda por ambiente e porque hardcodar amarraria o código a uma
 * guilda só.
 */
export interface GuildConfig {
  region: Region;
  name: string;
  realm: string;

  /**
   * Fuso em que a noite de raid é datada (IANA).
   *
   * Não é enfeite de exibição: é o que decide a **data** de uma noite, e a data
   * é a chave que casa o log do Warcraft Logs com a raid planejada no WoWAudit.
   *
   * A raid começa 21:00 BRT, que é 00:00 UTC do dia seguinte. Medido em
   * 04/08/2026 nos 20 logs mais recentes: por data UTC, só **12** caem numa data
   * com raid planejada; pelo fuso da guilda, **19** (o vigésimo é o log de
   * 18/07, que de fato não tem raid marcada). Datar em UTC jogaria 40% das
   * noites para o dia errado, sem erro nenhum.
   *
   * Região é US mas o horário é o da guilda — as duas coisas não têm relação.
   */
  timezone: string;

  /**
   * Corte de rank para a área interna — ver Regra 4 do CLAUDE.md.
   *
   * Rank 0 é o guild master, então o teste é `rank <= corte`. Fica em
   * configuração, e não em constante no código, porque `rank` é a **posição**
   * do rank na lista da guilda: reordenar ranks no jogo muda o significado do
   * número sem gerar erro nenhum.
   */
  rankAccessMax: number;

  /**
   * Corte de rank que dá status de **oficial** automaticamente — Regra 4.
   *
   * Mais restrito que `rankAccessMax`, e sobre outra coisa: aquele decide a
   * área interna, este decide histórico de outra pessoa e a lista de oficiais.
   *
   * Em configuração porque rank é posicional: reordenar ranks no jogo mudaria
   * quem é oficial sem erro nenhum.
   */
  officerRankMax: number;
}

/** Corte usado quando `GUILD_RANK_ACCESS_MAX` não está definida. */
const DEFAULT_RANK_ACCESS_MAX = 4;

/** Corte usado quando `GUILD_OFFICER_RANK_MAX` não está definida. */
const DEFAULT_OFFICER_RANK_MAX = 2;

/**
 * Lê e valida a config da guilda.
 *
 * Lança em vez de cair em default silencioso: guilda errada não dá erro, dá
 * roster vazio — e roster vazio faz *todo mundo* ser recusado como não-membro.
 * Falha de config tem que ser barulhenta.
 */
export function loadGuildConfig(env: NodeJS.ProcessEnv = process.env): GuildConfig {
  const region = regionSchema.safeParse(env.BLIZZARD_REGION ?? 'us');
  if (!region.success) {
    throw new Error(
      `BLIZZARD_REGION inválida: "${env.BLIZZARD_REGION}". Valores aceitos: us, eu, kr, tw, cn.`,
    );
  }

  if (region.data !== 'us') {
    throw new Error(
      `BLIZZARD_REGION está "${region.data}", mas a guilda é US-only. ` +
        'Se isso mudou de verdade, ajuste esta validação junto — não só o .env.',
    );
  }

  const name = env.GUILD_NAME?.trim();
  const realm = env.GUILD_REALM?.trim();

  if (!name || !realm) {
    throw new Error(
      'GUILD_NAME e GUILD_REALM são obrigatórios para consultar o roster. Ver .env.example.',
    );
  }

  const rankAccessMax = parseRankAccessMax(env);

  return {
    region: region.data,
    name,
    realm,
    timezone: parseTimezone(env),
    rankAccessMax,
    officerRankMax: parseOfficerRankMax(env, rankAccessMax),
  };
}

/** Fuso padrão quando `GUILD_TIMEZONE` não está definida. */
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Fuso da guilda, validado contra o banco de fusos do runtime.
 *
 * Valida **lançando**, porque fuso inválido não falha em `Intl` — ele
 * lança um `RangeError` bem longe daqui, dentro do job de presença, com
 * mensagem que não menciona configuração. Melhor morrer no boot.
 */
function parseTimezone(env: NodeJS.ProcessEnv): string {
  const raw = env.GUILD_TIMEZONE?.trim();
  if (!raw) return DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: raw });
  } catch {
    throw new Error(
      `GUILD_TIMEZONE inválido: "${raw}". Esperado um identificador IANA, ` +
        `como "${DEFAULT_TIMEZONE}".`,
    );
  }

  return raw;
}

/**
 * Corte de rank, com default seguro.
 *
 * Ausente cai no default de propósito: um `.env` antigo (de antes da Regra 4
 * mudar) não pode derrubar a API no boot. O default é o corte real da guilda,
 * então errar aqui restringe, não libera.
 *
 * Valor inválido **lança**, porque `Number('raider')` é `NaN` e toda comparação
 * com `NaN` é falsa — a área interna ficaria inacessível para todo mundo, sem
 * nenhuma mensagem de erro.
 */
function parseRankAccessMax(env: NodeJS.ProcessEnv): number {
  const raw = env.GUILD_RANK_ACCESS_MAX?.trim();
  if (!raw) return DEFAULT_RANK_ACCESS_MAX;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `GUILD_RANK_ACCESS_MAX inválido: "${raw}". Esperado um inteiro >= 0 ` +
        '(rank 0 é o guild master; o número cresce descendo a hierarquia).',
    );
  }

  return parsed;
}

/**
 * Corte de oficial, com default seguro e um limite que o outro corte não tem.
 *
 * Ausente cai no default (2, o corte real da guilda): um `.env` antigo não pode
 * derrubar a API no boot.
 *
 * Exige `<= rankAccessMax` porque `isActingOfficer()` pede acesso à área
 * interna junto — um corte mais frouxo marcaria gente como oficial com todas
 * as permissões falsas, invisível na tela.
 *
 * Esse limite **lança** se o valor foi escrito à mão, e **aperta em silêncio**
 * se é o default: quem escreveu 5 errou e precisa saber; quem só apertou o
 * outro corte não escreveu nada sobre oficiais.
 */
function parseOfficerRankMax(env: NodeJS.ProcessEnv, rankAccessMax: number): number {
  const raw = env.GUILD_OFFICER_RANK_MAX?.trim();
  if (!raw) return Math.min(DEFAULT_OFFICER_RANK_MAX, rankAccessMax);

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `GUILD_OFFICER_RANK_MAX inválido: "${raw}". Esperado um inteiro >= 0 ` +
        '(rank 0 é o guild master; o número cresce descendo a hierarquia).',
    );
  }

  if (parsed > rankAccessMax) {
    throw new Error(
      `GUILD_OFFICER_RANK_MAX (${parsed}) não pode ser maior que ` +
        `GUILD_RANK_ACCESS_MAX (${rankAccessMax}): ser oficial exige acesso à área interna, ` +
        'então esses ranks ficariam marcados como oficiais sem nenhuma permissão de oficial.',
    );
  }

  return parsed;
}
