import { z } from 'zod';

/**
 * O pacote de dado do cliente do WoW — TIT-137.
 *
 * É o que o gerador (TIT-139) emite a partir do dump do `wow.export` e o que a
 * rota de carga (TIT-140) valida antes de gravar. Um arquivo = **um build**.
 *
 * ## Por que colunar
 *
 * `{ cols, rows }` em vez de array de objetos, e a diferença não é estética.
 * Medido nas tabelas fixas do build 12.1.0: **2.556 KB** como objetos contra
 * **1.587 KB** colunar, porque o nome de cada coluna se repete uma vez por
 * linha no primeiro formato — e as tabelas por item level têm 1.300 linhas.
 *
 * ## Por que `cols` vem no arquivo, se a ordem já é conhecida
 *
 * Para a deriva de coluna FALHAR ALTO. A Blizzard mexe nas colunas dos db2 a
 * cada patch; se o arquivo só trouxesse `rows`, uma coluna a mais no meio
 * deslocaria todos os valores seguintes e o dado entraria trocado **sem erro
 * nenhum** — armadura no lugar de dano, e um tooltip plausível.
 *
 * Com `cols` explícito e conferido contra o esperado, isso vira recusa na
 * carga. É a mesma disciplina que `docs/db2-do-cliente.md` aplica ao resto:
 * lacuna é aceitável, valor errado com cara de certo não é.
 */

export const WOW_DATA_FILE_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* As colunas de cada tabela, na ordem                                        */
/* -------------------------------------------------------------------------- */

export const COLS_ITEM = [
  'itemId',
  'itemLevel',
  'quality',
  'inventoryType',
  'material',
  'bonding',
  'flags',
  'statIds',
  'statAllocs',
  'socketAllocs',
  'itemDelay',
  'dmgVariance',
  'flavor',
  'nameDescriptionId',
  'budgetIndex',
  'scalingType',
  'armorModifier',
  'effects',
] as const;

export const COLS_BONUS = [
  'bonusId',
  'trackName',
  'trackRank',
  'trackMaxRank',
  'trackScalingId',
  'itemLevel',
  'tertiary',
  'hasSocket',
  'binding',
  'difficulty',
  'difficultyColor',
  'quality',
] as const;

export const COLS_CONTEXT = ['itemId', 'itemContext', 'bonusId'] as const;

export const COLS_SCALING = [
  'itemLevel',
  'budget',
  'damageReplaceStat',
  'damageSecondary',
  'crMult',
  'stamMult',
  'socketCost',
  'armorTotal',
  'armorQuality',
  'armorShield',
  'dmgOneHand',
  'dmgTwoHand',
  'dmgOneHandCaster',
  'dmgTwoHandCaster',
] as const;

/* -------------------------------------------------------------------------- */
/* O envelope colunar                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Uma tabela no formato colunar, amarrada às colunas que se espera dela.
 *
 * Duas conferências, e as duas são recusa e não aviso:
 *
 * 1. `cols` tem que ser **exatamente** a lista esperada, na ordem. Coluna a
 *    mais, a menos ou trocada de lugar reprova o arquivo inteiro.
 * 2. toda linha tem que ter a mesma quantidade de valores que `cols`.
 *
 * O conteúdo de cada célula NÃO é validado aqui — quem faz isso é o schema de
 * linha da tabela, depois que o carregador transforma posição em nome.
 */
export function tabelaColunar<const C extends readonly string[]>(colunasEsperadas: C) {
  return z
    .object({
      cols: z.string().array(),
      rows: z.array(z.array(z.unknown())),
    })
    .superRefine((tabela, ctx) => {
      const esperado = colunasEsperadas.join(',');
      const veio = tabela.cols.join(',');

      if (veio !== esperado) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `colunas divergem do esperado.\n  esperado: ${esperado}\n  veio:     ${veio}`,
        });
        // Sem as colunas certas, conferir a aridade das linhas só produziria
        // ruído em cima do erro que importa.
        return;
      }

      const arity = colunasEsperadas.length;
      for (const [i, linha] of tabela.rows.entries()) {
        if (linha.length !== arity) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', i],
            message: `linha com ${linha.length} valores, esperado ${arity}`,
          });
        }
      }
    });
}

export type TabelaColunar = z.infer<ReturnType<typeof tabelaColunar>>;

/**
 * Transforma a tabela colunar em objetos, casando posição com nome.
 *
 * Só é seguro depois que `tabelaColunar` aprovou — é ela que garante que a
 * ordem de `cols` é a esperada e que as linhas têm a aridade certa.
 */
export function linhasParaObjetos<const C extends readonly string[]>(
  colunas: C,
  tabela: TabelaColunar,
): Array<Record<C[number], unknown>> {
  return tabela.rows.map((linha) => {
    const objeto = {} as Record<C[number], unknown>;
    for (const [i, coluna] of colunas.entries()) {
      objeto[coluna as C[number]] = linha[i];
    }
    return objeto;
  });
}

/* -------------------------------------------------------------------------- */
/* O arquivo                                                                  */
/* -------------------------------------------------------------------------- */

export const wowDataFileSchema = z.object({
  version: z.literal(WOW_DATA_FILE_VERSION),

  /**
   * O build do cliente de onde tudo isto saiu — `12.1.0.69299`.
   *
   * **Sem ele, divergência futura é indistinguível entre bug nosso e mudança
   * de patch**, que é a mesma razão pela qual `db2-fixture-de-itens.json`
   * carrega o build. É também a chave de `WowDataBuild`.
   */
  build: z.string().min(1),

  itens: tabelaColunar(COLS_ITEM),
  bonuses: tabelaColunar(COLS_BONUS),
  contextos: tabelaColunar(COLS_CONTEXT),
  escalas: tabelaColunar(COLS_SCALING),
});
export type WowDataFile = z.infer<typeof wowDataFileSchema>;
