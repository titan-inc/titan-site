import { candidatosDoMercado, type Candidato } from './candidatos';

/**
 * T-K02 — os candidatos de um mercado saem do snapshot congelado, filtrados
 * pela role do tipo (D-04, D-13). Participação no WCL não entra: a função nem
 * recebe essa informação.
 */
const snapshot: Candidato[] = [
  { characterId: 'tank', role: 'Tank' },
  { characterId: 'melee', role: 'Melee' },
  { characterId: 'heal', role: 'Heal' },
  { characterId: 'ranged', role: 'Ranged' },
];

const ids = (lista: Candidato[]) => lista.map((c) => c.characterId).sort();

describe('candidatosDoMercado (T-K02)', () => {
  it.each(['top_dps', 'top_dps_parse'] as const)('%s: Melee e Ranged', (kind) => {
    expect(ids(candidatosDoMercado(kind, snapshot))).toEqual(['melee', 'ranged']);
  });

  it.each(['top_hps', 'top_hps_parse'] as const)('%s: Heal', (kind) => {
    expect(ids(candidatosDoMercado(kind, snapshot))).toEqual(['heal']);
  });

  it.each(['top_dispels', 'first_death'] as const)('%s: o snapshot inteiro', (kind) => {
    expect(ids(candidatosDoMercado(kind, snapshot))).toEqual(['heal', 'melee', 'ranged', 'tank']);
  });

  it('Weekly Progression não tem candidato de personagem', () => {
    expect(candidatosDoMercado('weekly_progression', snapshot)).toEqual([]);
  });

  it('nunca devolve quem não está no snapshot', () => {
    for (const kind of ['top_dps', 'top_hps', 'first_death'] as const) {
      for (const c of candidatosDoMercado(kind, snapshot)) {
        expect(snapshot).toContainEqual(c);
      }
    }
  });
});
