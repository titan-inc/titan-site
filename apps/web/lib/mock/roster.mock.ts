import type { RosterEntry } from '@titan/shared';
import './index';

export interface TripulanteMock extends RosterEntry {
  spec: string | null;
  portraitUrl: string | null;
}

const classes = [
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
const roles = ['Tank', 'Healer', 'Melee', 'Ranged'];
const nomes = [
  'Íon',
  'Ión',
  'No',
  'Arkenfall',
  'Velarium',
  'Kairós',
  'Mistrunner',
  'Solstice',
  'Umbraférrea',
  'Thalassian',
  'Nox',
  'Asterion',
];
const realms = ['azralon', 'goldrinn', 'nemesis', 'tol-barad'];

export const ROSTER_MOCK_50: TripulanteMock[] = Array.from({ length: 50 }, (_, indice) => ({
  name: `${nomes[indice % nomes.length]}${indice > 11 ? indice : ''}`.slice(0, 12),
  realm: realms[indice % realms.length],
  wowClass: classes[indice % classes.length],
  spec:
    indice % 7 === 0
      ? 'Especialização de campo'
      : ['Protection', 'Restoration', 'Discipline', 'Frost'][indice % 4],
  role: roles[indice % roles.length],
  portraitUrl: null,
  itemLevel: indice === 47 || indice === 49 ? null : 280 + (indice % 17) + indice / 100,
  mythicPlusScore: indice === 48 || indice === 49 ? null : 2200 + indice * 31.7,
}));

export const ROSTER_MOCK = {
  1: ROSTER_MOCK_50.slice(0, 1),
  2: ROSTER_MOCK_50.slice(0, 2),
  5: ROSTER_MOCK_50.slice(0, 5),
  8: ROSTER_MOCK_50.slice(0, 8),
  12: ROSTER_MOCK_50.slice(0, 12),
  16: ROSTER_MOCK_50.slice(0, 16),
  20: ROSTER_MOCK_50.slice(0, 20),
  30: ROSTER_MOCK_50.slice(0, 30),
  50: ROSTER_MOCK_50,
} as const;
