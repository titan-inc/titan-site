import { RAID_DIFFICULTIES, type RaidDifficultyLevel } from './wow.js';

/**
 * Posição do `itemContext` no `itemString`, já contando o literal `item:`.
 *
 * O formato documentado é
 *
 * ```
 * itemID : enchantID : gemID1..4 : suffixID : uniqueID : linkLevel :
 * specializationID : modifiersMask : itemContext : numBonusIDs : bonusIDs…
 * ```
 *
 * ou seja `itemContext` é o 12º campo — mas a string começa com `item:`, então
 * tudo anda um índice e o campo é o `[12]` do split, não o `[11]`. Ler o 11 dá
 * `modifiersMask`, que é vazio na esmagadora maioria das peças: o erro se
 * disfarça de "o campo não existe" em vez de estourar.
 */
const INDICE_ITEM_CONTEXT = 12;

/**
 * `itemContext` → dificuldade de raid.
 *
 * Só os três de raid. Os outros códigos existem (dungeon, mundo, craft, e a
 * lista vai até 186) e são deliberadamente ausentes: esta função responde
 * "de que dificuldade de raid esta peça veio", e para tudo mais a resposta certa
 * é "não sei", nunca um chute.
 */
const CONTEXTO_DE_RAID: Readonly<Record<string, RaidDifficultyLevel>> = {
  '3': RAID_DIFFICULTIES.NORMAL,
  '5': RAID_DIFFICULTIES.HEROIC,
  '6': RAID_DIFFICULTIES.MYTHIC,
};

/**
 * A dificuldade da **peça**, lida do próprio `itemString`.
 *
 * Não confundir com a dificuldade da **sala** onde o item foi entregue. As duas
 * divergem legitimamente, e é a peça que interessa: uma peça mítica tradeável só
 * existe se caiu no mítico, então o contexto é fato sobre o item, enquanto o
 * nome da instância é só onde as pessoas estavam de pé na hora do award.
 *
 * Medido no export do RCLootCouncil: nas 294 linhas de conselho o campo assume
 * exatamente `3`, `5` e `6`, e diverge do sufixo da instância em 20 delas —
 * loot de farm heroico distribuído já dentro do mítico enquanto o grupo alinhava
 * estratégia, e o caso inverso. Não é anomalia nem dado sujo.
 *
 * Devolve `null` quando não é peça de raid ou quando a string não tem o campo.
 * Lacuna, nunca `normal` por omissão — Regra 7.
 */
export function raidDifficultyFromItemString(itemString: string): RaidDifficultyLevel | null {
  // Split sem filtrar vazios: campo vazio é a regra (`item:249308::::::::90:252::5`),
  // e descartá-los faria todas as posições andarem.
  const campos = itemString.split(':');
  return CONTEXTO_DE_RAID[campos[INDICE_ITEM_CONTEXT] ?? ''] ?? null;
}

/** Onde o `itemID` e o contador de bônus ficam, já contando o literal `item:`. */
const INDICE_ITEM_ID = 1;
const INDICE_NUM_BONUS = 13;
const INDICE_PRIMEIRO_BONUS = 14;

/** O que dá para ler de um `itemString` sem dicionário nenhum. */
export interface ItemStringLido {
  itemId: number;

  /**
   * De onde a peça veio. **Nulo é "não sei", nunca zero** — zero é valor válido
   * de outra coisa, e colapsar os dois afirmaria um contexto que ninguém viu.
   */
  itemContext: number | null;

  /**
   * Os bônus, delimitados pelo contador — nunca por comprimento fixo.
   *
   * Depois deles ainda vêm modifiers, relic, `crafterGUID` e `extraEnchantID`.
   * Fatiar até o fim traria tudo isso como se fosse bônus.
   */
  bonusIds: number[];
}

/**
 * Lê o que dá do `itemString`, sem interpretar significado.
 *
 * Devolve `null` quando nem o `itemID` sai — aí não é item, é lixo.
 *
 * ## As armadilhas que este parse trata, todas vistas em dado real
 *
 * 1. **Campo vazio é a regra** (`::::::`). O split não pode filtrar vazios: as
 *    posições andariam e tudo desalinharia.
 * 2. **`numBonusIDs` pode vir VAZIO**, e significa **zero bônus**. `Number('')`
 *    é `0`, o que por sorte acerta — mas `parseInt('')` é `NaN`, e é por isso que
 *    a leitura é explícita em vez de confiar na coerção.
 * 3. **`itemContext` pode vir VAZIO**, e significa **desconhecido**, não zero.
 *    Os dois vazios da mesma linha querem dizer coisas diferentes.
 * 4. Depois dos bônus vêm campos de outros tipos — modifier com **valor
 *    negativo**, `crafterGUID` com hífen. Por isso o corte é pelo contador.
 *
 * Os casos 2 e 3 apareceram juntos em loot de boss real: um reagente épico e uma
 * receita, os dois drop legítimo. Nenhum item "normal" de raid os expõe, que é
 * justamente por que ninguém pensa em usá-los como fixture.
 */
export function parseItemString(itemString: string): ItemStringLido | null {
  const campos = itemString.split(':');

  const itemId = Number(campos[INDICE_ITEM_ID]);
  if (!Number.isInteger(itemId) || itemId <= 0) return null;

  return {
    itemId,
    itemContext: inteiroOuNulo(campos[INDICE_ITEM_CONTEXT]),
    bonusIds: lerBonus(campos),
  };
}

/** Vazio e não-numérico viram nulo. Nunca zero — zero é um valor de verdade. */
function inteiroOuNulo(bruto: string | undefined): number | null {
  if (bruto === undefined || bruto === '') return null;

  const valor = Number(bruto);
  return Number.isInteger(valor) ? valor : null;
}

function lerBonus(campos: string[]): number[] {
  // Vazio aqui é ZERO bônus — diferente do contexto vazio, que é "não sei".
  const quantos = inteiroOuNulo(campos[INDICE_NUM_BONUS]) ?? 0;
  if (quantos <= 0) return [];

  return campos
    .slice(INDICE_PRIMEIRO_BONUS, INDICE_PRIMEIRO_BONUS + quantos)
    .map((b) => Number(b))
    .filter((b) => Number.isInteger(b) && b > 0);
}
