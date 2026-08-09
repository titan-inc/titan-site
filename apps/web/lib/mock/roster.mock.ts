/** Fixture legada mantida somente porque classe.spec.ts é protegido contra alteração. */
export const ROSTER_MOCK_50 = [
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
].map((wowClass, indice) => ({ wowClass, name: `Fixture ${indice}` }));
