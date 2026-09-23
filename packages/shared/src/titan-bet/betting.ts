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
 * Aposta de Weekly Progression (D-54): **um** boss de progressão da rodada —
 * "este boss será morto pela primeira vez nesta semana?". `encounterId` é o id
 * do encounter da rodada.
 */
const apostaWeeklySchema = z
  .object({
    marketId: z.string().min(1),
    stake: stakeSchema,
    encounterId: z.string().min(1),
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

/** Os estados do slip (D-27, D-34, D-35) — os mesmos do enum do banco. */
export const betSlipStatusSchema = z.enum([
  'rascunho',
  'aguardando_deposito',
  'valido',
  'recusado',
  'expirado',
]);
export type BetSlipStatus = z.infer<typeof betSlipStatusSchema>;

/**
 * O próprio slip, para o dono (D-36). As apostas voltam na mesma forma do
 * Salvar, para o form reabrir o rascunho sem tradução. Sem id de conta: a
 * sessão já diz de quem é.
 */
export const meuSlipSchema = z
  .object({
    slipId: z.string(),
    status: betSlipStatusSchema,
    apostas: z.array(apostaDoSlipSchema),
    depositCharacterId: z.string().nullable(),
    expectedTotal: z.number().int().nullable(),
    rejectionReason: z.string().nullable(),
  })
  .strict();
export type MeuSlip = z.infer<typeof meuSlipSchema>;

/**
 * Um depósito pendente, como o officer vê para conferir no Guild Bank (§16.9).
 *
 * Montado só de `BetSlip`: dono, depositante e total — nunca a escolha. Estrito
 * para que um join conveniente com `Bet` quebre o parse em vez de vazar
 * (T-D01). Se a tela de confirmação mostra as apostas é a OQ-48, que não
 * mexe aqui.
 */
export const depositoPendenteSchema = z
  .object({
    slipId: z.string(),
    ownerBattletag: z.string(),
    depositCharacter: z.object({ name: z.string(), realm: z.string() }).strict(),
    expectedTotal: z.number().int(),
    status: z.literal('aguardando_deposito'),
    submittedAt: z.string().datetime(),
  })
  .strict();
export type DepositoPendente = z.infer<typeof depositoPendenteSchema>;

export const depositosPendentesSchema = z.object({ depositos: z.array(depositoPendenteSchema) });
export type DepositosPendentes = z.infer<typeof depositosPendentesSchema>;
