import { describe, expect, it } from 'vitest';
import { raidDifficultyFromItemString } from './item-string.js';
import { RAID_DIFFICULTIES } from './wow.js';

/**
 * Formas reais de `itemString`, com o item trocado por um id qualquer. Não há
 * dado de pessoa num itemString, mas os valores aqui são inventados mesmo assim.
 */
const HEROICA = 'item:249308::::::::90:252::5:4:6652:13577:13334:12794';
const NORMAL = 'item:249308::::::::90:252::3:2:6652:13333';
const MITICA = 'item:249308::::::::90:252::6:3:6652:13335:12806';

describe('raidDifficultyFromItemString', () => {
  it('lê as três dificuldades de raid', () => {
    expect(raidDifficultyFromItemString(NORMAL)).toBe(RAID_DIFFICULTIES.NORMAL);
    expect(raidDifficultyFromItemString(HEROICA)).toBe(RAID_DIFFICULTIES.HEROIC);
    expect(raidDifficultyFromItemString(MITICA)).toBe(RAID_DIFFICULTIES.MYTHIC);
  });

  it('lê a posição 12 contando o literal `item:`, não a 11', () => {
    // O erro que este teste tranca: ler o índice 11 pega `modifiersMask`, que é
    // vazio na esmagadora maioria das peças. O sintoma seria "todo item é nulo",
    // que parece campo inexistente em vez de índice errado — foi exatamente o
    // que aconteceu na primeira leitura do export.
    const campos = HEROICA.split(':');

    expect(campos[11]).toBe('');
    expect(campos[12]).toBe('5');
  });

  it('contexto que não é de raid vira nulo, nunca uma dificuldade', () => {
    // 35, 150, 151, 152 aparecem no export real, todos em loot que não passou
    // pelo conselho. Chutar `normal` aqui inventaria fato — Regra 7.
    for (const ctx of ['35', '150', '151', '152', '13', '1']) {
      expect(raidDifficultyFromItemString(`item:249308::::::::90:252::${ctx}:0`)).toBeNull();
    }
  });

  it('string sem o campo vira nulo em vez de estourar', () => {
    expect(raidDifficultyFromItemString('item:249308')).toBeNull();
    expect(raidDifficultyFromItemString('')).toBeNull();
  });

  it('não filtra campos vazios ao quebrar', () => {
    // Filtrar vazios faria todas as posições andarem e a leitura casaria com
    // outro campo — sem erro nenhum, que é o pior jeito de errar.
    const muitosVazios = 'item:249308::::::::90:252::6:1:6652';

    expect(raidDifficultyFromItemString(muitosVazios)).toBe(RAID_DIFFICULTIES.MYTHIC);
  });
});
