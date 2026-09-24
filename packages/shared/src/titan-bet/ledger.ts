import { z } from 'zod';

/**
 * Titan Bet — pagamento e ajuste no Officer Panel (§16.6, D-11).
 *
 * O ledger é a única autoridade financeira: pagar lança o saldo, e corrigir é
 * `ajuste` com motivo e referência — nunca reescrever um lançamento.
 */

/** Ajuste na conta de um membro: valor com sinal, motivo e o lançamento corrigido. */
export const ajustarSchema = z
  .object({
    amount: z
      .number()
      .int()
      .refine((v) => v !== 0, 'ajuste de zero não muda nada'),
    reason: z.string().trim().min(1),
    /** Id do lançamento corrigido — número grande, trafega como texto. */
    correctsEntryId: z.string().regex(/^\d+$/),
  })
  .strict();
export type Ajustar = z.infer<typeof ajustarSchema>;

/**
 * O total por membro na rodada (§8.5): quanto ainda é devido e quanto já foi
 * pago. Nenhuma aposta, stake ou escolha.
 */
export const saldosDaRodadaSchema = z
  .object({
    saldos: z.array(
      z
        .object({
          slipId: z.string(),
          ownerBattletag: z.string(),
          devido: z.number().int(),
          pago: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export type SaldosDaRodada = z.infer<typeof saldosDaRodadaSchema>;

/**
 * T-C06: os lançamentos de um slip, para o officer escolher o que o ajuste
 * corrige (D-11). O ledger como registrou — sem aposta, mercado ou escolha.
 */
export const lancamentosDoSlipSchema = z
  .object({
    lancamentos: z.array(
      z
        .object({
          /** BigInt no banco: trafega como texto, e é o `correctsEntryId` do ajuste. */
          entryId: z.string().regex(/^\d+$/),
          kind: z.enum([
            'deposito_validado',
            'premio',
            'restituicao_anulado',
            'receita_guilda',
            'residuo_guilda',
            'restituicao_expirado',
            'ajuste',
            'pagamento',
          ]),
          amount: z.number().int(),
          reason: z.string().nullable(),
          actorBattletag: z.string().nullable(),
          createdAt: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();
export type LancamentosDoSlip = z.infer<typeof lancamentosDoSlipSchema>;
