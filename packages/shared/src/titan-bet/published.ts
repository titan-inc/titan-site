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
