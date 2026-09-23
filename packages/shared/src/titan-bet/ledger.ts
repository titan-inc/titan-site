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
