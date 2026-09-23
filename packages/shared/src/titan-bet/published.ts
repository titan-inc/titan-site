import { z } from 'zod';

/**
 * Titan Bet — contrato PUBLICADO (spec do Titan Bet §9.1): o que qualquer
 * bettor da rodada vê.
 *
 * **Não importa nada de `betting.ts`.** Um schema que não tem campo de stake
 * não consegue serializar stake: o vazamento provável não é um endpoint "ver
 * apostas dos outros", é um DTO que ganha um campo num join conveniente — e
 * aqui o parse estrito quebra antes.
 */

/**
 * Projected payout de uma opção (R-35, §8.4): o retorno por 1g se o mercado
 * fechasse agora e esta fosse a única vencedora. `null` é "—", opção sem
 * aposta válida. Não é probabilidade nem garantia (R-34).
 */
const opcaoDeOddsSchema = z
  .object({
    characterId: z.string(),
    multiplicador: z.number().positive().nullable(),
  })
  .strict();

const mercadoDeOddsSchema = z
  .object({
    marketId: z.string(),
    opcoes: z.array(opcaoDeOddsSchema),
  })
  .strict();

/**
 * As odds da rodada, só com o multiplicador por opção (§16.10) — nunca conta,
 * slip, stake individual ou lista de apostas.
 *
 * Só mercados de escolha simples: o da Weekly Progression é a OQ-55.
 */
export const oddsDaRodadaSchema = z
  .object({
    roundId: z.string(),
    mercados: z.array(mercadoDeOddsSchema),
  })
  .strict();
export type OddsDaRodada = z.infer<typeof oddsDaRodadaSchema>;

/**
 * Um membro no documento publicado: o personagem de elegibilidade da aposta,
 * como o snapshot de bettors do Ready gravou (D-48). Nunca BattleTag.
 */
const personagemPublicoSchema = z.object({ name: z.string(), realm: z.string() }).strict();

const mercadoPublicadoSchema = z
  .object({
    marketId: z.string(),
    kind: z.enum([
      'top_dps',
      'top_dps_parse',
      'top_hps',
      'top_hps_parse',
      'top_dispels',
      'first_death',
      'weekly_progression',
    ]),
    /** Nulo na Weekly, que é da rodada. */
    encounterName: z.string().nullable(),
    desfecho: z.enum(['vencedores', 'anulado']),
    voidReason: z.string().nullable(),
    /** Os candidatos vencedores do mercado. */
    vencedores: z.array(personagemPublicoSchema),
    /** `K` da Weekly, pelos nomes dos encounters. */
    kills: z.array(z.string()),
    /** Quem ganhou neste mercado e quanto — só vencedores (D-21, D-48). */
    ganhos: z.array(
      z.object({ membro: personagemPublicoSchema, valor: z.number().int().positive() }).strict(),
    ),
  })
  .strict();

/**
 * O Round Closing Report publicado (§8.5, §16.7): mercados, resultados,
 * vencedores, ganho por mercado, VOID, resumo do Guild Bank e o total devido
 * por membro. **Nunca** stake, aposta perdedora, escolha, slip ou depósito —
 * estrito em todos os níveis, para um campo a mais quebrar o parse.
 */
export const closingReportSchema = z
  .object({
    versao: z.literal(1),
    roundId: z.string(),
    period: z.number().int(),
    mercados: z.array(mercadoPublicadoSchema),
    guildBank: z
      .object({ receita: z.number().int().nonnegative(), residuo: z.number().int().nonnegative() })
      .strict(),
    /** Prêmios + restituições + ajustes da conta, por personagem (D-48). */
    totais: z.array(
      z.object({ membro: personagemPublicoSchema, devido: z.number().int() }).strict(),
    ),
  })
  .strict();
export type ClosingReport = z.infer<typeof closingReportSchema>;

/** O documento como a rota devolve: a versão publicada e o conteúdo. */
export const closingPublicadoSchema = z
  .object({
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    conteudo: closingReportSchema,
  })
  .strict();
export type ClosingPublicado = z.infer<typeof closingPublicadoSchema>;
