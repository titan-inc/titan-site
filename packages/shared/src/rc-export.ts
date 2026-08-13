import { z } from 'zod';

/**
 * Um registro do export do RCLootCouncil.
 *
 * O formato é o que o addon cospe, não um contrato que a gente escolheu — este
 * schema descreve, não negocia. Medido nas 445 linhas do export real de 17/03 a
 * 25/06/2026: **tudo é string, menos `itemID` e `votes`**. Inclusive
 * `servertime` (epoch como texto) e `isAwardReason` (`"false"`/`"true"`).
 *
 * Campos que a gente não lê — `date`, `time`, `rollType`, `subType`, `equipLoc`,
 * `itemName`, `isAwardReason` — são deliberadamente omitidos, e o Zod os descarta.
 * `isAwardReason` sai porque é derivável do `kind` da opção (`banking` é
 * `loot_master`), e duplicar criaria dois lugares para discordar. `itemName` sai
 * porque é o nome no idioma de quem exportou; nome canônico vem do catálogo.
 *
 * Rigor desigual, de propósito: obrigatório no que identifica a entrega, tolerante
 * no que é enfeite. Arquivo histórico de outra season pode não ter uma coluna
 * decorativa, e recusar o arquivo inteiro por causa disso seria perder histórico
 * que não volta.
 */
export const rcExportRecordSchema = z.object({
  /**
   * `<servertime>-<índice>`, único no arquivo — 445 de 445 distintos.
   *
   * É o que faz reimportar não duplicar, então é o único campo cuja ausência
   * torna o registro inútil: sem ele não há idempotência.
   */
  id: z.string().min(1),

  /** `Nome-Realm`, no formato do cliente do jogo. 445 de 445 têm o hífen. */
  player: z.string().min(1),

  /** Quem lootou no jogo. Mesmo formato. */
  owner: z.string().min(1),

  itemID: z.number().int().positive(),
  itemString: z.string().min(1),

  /**
   * Os dois campos da resposta, que só valem juntos.
   *
   * O rótulo varia de caixa e idioma (`BiS`/`BIS`, `Bonus Loot`/`Bonus de botín`)
   * e o `responseID` é posicional — `2` é `Big` num raid e `Banking` noutro. Ver
   * `matchLegacyResponse`.
   */
  response: z.string(),
  responseID: z.string(),

  /** Epoch em segundos, como texto. Vira o `awardedAt`. */
  servertime: z.string().regex(/^\d+$/, 'servertime deve ser epoch numérico'),

  /** `The Voidspire-Heroic`, `A Torre do Caos-Normal`. Localizado. */
  instance: z.string().min(1),
  boss: z.string(),

  /** Token do cliente (`MAGE`), não localizado. */
  class: z.string().optional().default(''),

  /**
   * Votos do conselho.
   *
   * Ausente vira `null` e não `0`: zero é resultado — o conselho olhou e ninguém
   * votou —, enquanto ausência é fonte que não tem o conceito.
   */
  votes: z.number().int().nonnegative().nullable().optional(),

  /** O que a peça substituiu. String vazia quando não substituiu nada. */
  gear1: z.string().optional().default(''),
  gear2: z.string().optional().default(''),

  note: z.string().optional().default(''),
});
export type RcExportRecord = z.infer<typeof rcExportRecordSchema>;

/**
 * O arquivo inteiro.
 *
 * Sem teto de tamanho aqui: quem limita é o body parser do Nest, antes de o Zod
 * ver o conteúdo — 2mb no prefixo de ops. Repetir o limite em dois lugares só
 * cria a chance de eles discordarem.
 */
export const rcExportSchema = z.array(rcExportRecordSchema);
export type RcExport = z.infer<typeof rcExportSchema>;

/**
 * Quebra `Nome-Realm` no par.
 *
 * O realm vem à moda do cliente do jogo, sem separador: `Kusiak-Area52`,
 * `Decenty-DemonSoul`. Quem normaliza é quem chama — este corte é só sintático.
 *
 * Corta no **primeiro** hífen porque o nome do personagem não tem hífen: WoW não
 * permite. Verificado no export real, zero registros com mais de um hífen. Já o
 * realm pode ter, se algum dia vier de fonte que use a grafia da Blizzard.
 */
export function splitNomeRealm(valor: string): { name: string; realm: string } | null {
  const corte = valor.indexOf('-');
  if (corte <= 0 || corte === valor.length - 1) return null;

  return { name: valor.slice(0, corte), realm: valor.slice(corte + 1) };
}
