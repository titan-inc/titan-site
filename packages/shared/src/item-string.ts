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
