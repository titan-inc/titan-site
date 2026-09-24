import { z } from 'zod';
import { characterInputSchema } from '../wow.js';
import { mercadoDeBossSchema } from './config.js';

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

/**
 * "Submeter pagamento" (D-27): o personagem que deposita, informado por nome +
 * realm (D-55). Qualquer personagem, não só os ligados à conta — quem confere
 * que é do apostador é o officer, na confirmação. Sem região (Regra 6).
 */
export const submeterSlipSchema = z
  .object({ depositCharacter: characterInputSchema.strict() })
  .strict();
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
    /** Como o membro informou no Submeter (D-55); nulo antes dele. */
    depositCharacter: z.object({ name: z.string(), realm: z.string() }).strict().nullable(),
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
 * (T-D01). As apostas, o officer vê em outra superfície, registrada: o "ver
 * slip" (D-57, `slipDoOfficerSchema`).
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

const personagemVistoSchema = z.object({ name: z.string(), realm: z.string() }).strict();

/** Uma aposta como o officer vê: o alvo com nome, não só o id. */
const apostaVistaSchema = z.union([
  z
    .object({
      marketId: z.string(),
      marketKind: mercadoDeBossSchema,
      stake: z.number().int(),
      alvo: z.object({ characterId: z.string(), name: z.string(), realm: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      marketId: z.string(),
      marketKind: z.literal('weekly_progression'),
      stake: z.number().int(),
      boss: z.object({ roundEncounterId: z.string(), encounterName: z.string() }).strict(),
    })
    .strict(),
]);

/**
 * "Ver slip" do Officer Panel, para disputa (D-57): o slip exatamente como foi
 * submetido, **somente leitura**. Cada leitura fica registrada em `BetEvent`.
 *
 * Rascunho fica de fora: não foi submetido, e é escolha que o membro ainda
 * pode mudar. Estrito, sem id de conta — o dono aparece pelo battletag
 * gravado no slip.
 */
export const slipDoOfficerSchema = z
  .object({
    slipId: z.string(),
    roundId: z.string(),
    status: z.enum(['aguardando_deposito', 'valido', 'recusado', 'expirado']),
    ownerBattletag: z.string(),
    eligibilityCharacter: personagemVistoSchema,
    depositCharacter: personagemVistoSchema,
    expectedTotal: z.number().int(),
    submittedAt: z.string().datetime(),
    apostas: z.array(apostaVistaSchema),
    validatedByBattletag: z.string().nullable(),
    validatedAt: z.string().datetime().nullable(),
    rejectedByBattletag: z.string().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
    expiredAt: z.string().datetime().nullable(),
  })
  .strict();
export type SlipDoOfficer = z.infer<typeof slipDoOfficerSchema>;
