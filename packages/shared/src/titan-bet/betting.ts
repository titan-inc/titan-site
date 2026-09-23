import { z } from 'zod';

/**
 * Titan Bet — contrato PRIVADO do Bet Slip (spec do Titan Bet §9.1).
 *
 * Só para o dono do slip e fluxos autorizados. O contrato publicado
 * (resultados, closing report, odds) vive em outro arquivo e não importa nada
 * daqui: um schema que não tem campo de stake não consegue serializar stake.
 */

/** Stake de uma aposta, em gold inteiro (R-16). */
export const STAKE_MINIMO = 200;
export const STAKE_MAXIMO = 1000;

const stakeSchema = z.number().int().min(STAKE_MINIMO).max(STAKE_MAXIMO);

/** Aposta de escolha simples: exatamente um personagem candidato (D-28). */
const apostaSimplesSchema = z
  .object({
    marketId: z.string().min(1),
    stake: stakeSchema,
    targetCharacterId: z.string().min(1),
  })
  .strict();

/**
 * Aposta de Weekly Progression: um stake para o conjunto exato de bosses,
 * inclusive vazio — `{}` é a previsão "nenhum boss morre" (D-15, D-28).
 */
const apostaWeeklySchema = z
  .object({
    marketId: z.string().min(1),
    stake: stakeSchema,
    encounterIds: z
      .array(z.string().min(1))
      .refine((ids) => new Set(ids).size === ids.length, 'boss repetido na seleção'),
  })
  .strict();

export const apostaDoSlipSchema = z.union([apostaSimplesSchema, apostaWeeklySchema]);
export type ApostaDoSlip = z.infer<typeof apostaDoSlipSchema>;

/**
 * "Salvar" (D-27): o rascunho inteiro, como está agora. Pode ser vazio. Uma
 * aposta por mercado (D-28).
 */
export const salvarSlipSchema = z.object({
  apostas: z
    .array(apostaDoSlipSchema)
    .refine(
      (apostas) => new Set(apostas.map((a) => a.marketId)).size === apostas.length,
      'uma aposta por mercado',
    ),
});
export type SalvarSlip = z.infer<typeof salvarSlipSchema>;

/** "Submeter pagamento" (D-27): o personagem da conta que deposita (D-02). */
export const submeterSlipSchema = z.object({ depositCharacterId: z.string().min(1) });
export type SubmeterSlip = z.infer<typeof submeterSlipSchema>;

/** Recusa de depósito pelo officer: o motivo é obrigatório (D-34). */
export const recusarDepositoSchema = z.object({ motivo: z.string().trim().min(1) });
export type RecusarDeposito = z.infer<typeof recusarDepositoSchema>;
