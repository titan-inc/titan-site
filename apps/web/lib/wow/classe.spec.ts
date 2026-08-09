import { describe, expect, it } from 'vitest';
import { ROSTER_MOCK_50 } from '../mock/roster.mock';
import { corDaClasse } from './classe';

/** As 13 grafias como o WoWAudit as escreve. */
const GRAFIAS = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Death Knight',
  'Shaman',
  'Mage',
  'Warlock',
  'Monk',
  'Druid',
  'Demon Hunter',
  'Evoker',
];

describe('cor de classe', () => {
  it('reconhece as 13 grafias do WoWAudit', () => {
    for (const grafia of GRAFIAS) expect(corDaClasse(grafia), grafia).not.toBeNull();
  });

  it('devolve 13 cores distintas', () => {
    const cores = new Set(GRAFIAS.map((grafia) => corDaClasse(grafia)));
    expect(cores.size).toBe(13);
  });

  it('reconhece toda classe presente no roster de mock', () => {
    for (const tripulante of ROSTER_MOCK_50)
      expect(corDaClasse(tripulante.wowClass), tripulante.wowClass).not.toBeNull();
  });

  it('tolera espaço duplo no meio', () =>
    expect(corDaClasse('Death  Knight')).toBe(corDaClasse('Death Knight')));

  it('tolera espaço nas pontas e capitalização', () =>
    expect(corDaClasse('  priest ')).toBe(corDaClasse('Priest')));

  // Falha silenciosa é o risco desta função: `CORES[wowClass]` devolveria
  // `undefined` e pintaria a placa de transparente sem erro nenhum.
  it('devolve null para grafia desconhecida, sem lançar', () =>
    expect(corDaClasse('Tinkerer')).toBeNull());

  it('devolve null para string vazia, sem lançar', () => expect(corDaClasse('')).toBeNull());
});
