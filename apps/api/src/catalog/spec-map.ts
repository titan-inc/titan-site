import type { WowSpec as PrismaWowSpec } from '@prisma/client';
import type { WowSpec } from '@titan/shared';

/**
 * Tradução entre o enum do banco e o slug do contrato.
 *
 * Os dois não podem ser iguais: enum do Prisma não aceita hífen, então o banco
 * usa `death_knight_blood` e o shared usa `death-knight-blood`.
 *
 * O mapa é explícito, e não um `replaceAll('_', '-')`, por dois motivos. O
 * `Record<PrismaWowSpec, WowSpec>` obriga o TypeScript a exigir **todas** as
 * specs do banco e a aceitar só slugs válidos do shared — então acrescentar spec
 * de um lado só quebra no build, em vez de virar valor estranho na tela. E a
 * troca de caractere pararia de funcionar em silêncio no dia em que um slug
 * legítimo tivesse underscore.
 */
export const SPEC_FROM_DB: Record<PrismaWowSpec, WowSpec> = {
  death_knight_blood: 'death-knight-blood',
  death_knight_frost: 'death-knight-frost',
  death_knight_unholy: 'death-knight-unholy',
  demon_hunter_havoc: 'demon-hunter-havoc',
  demon_hunter_vengeance: 'demon-hunter-vengeance',
  druid_balance: 'druid-balance',
  druid_feral: 'druid-feral',
  druid_guardian: 'druid-guardian',
  druid_restoration: 'druid-restoration',
  evoker_augmentation: 'evoker-augmentation',
  evoker_devastation: 'evoker-devastation',
  evoker_preservation: 'evoker-preservation',
  hunter_beast_mastery: 'hunter-beast-mastery',
  hunter_marksmanship: 'hunter-marksmanship',
  hunter_survival: 'hunter-survival',
  mage_arcane: 'mage-arcane',
  mage_fire: 'mage-fire',
  mage_frost: 'mage-frost',
  monk_brewmaster: 'monk-brewmaster',
  monk_mistweaver: 'monk-mistweaver',
  monk_windwalker: 'monk-windwalker',
  paladin_holy: 'paladin-holy',
  paladin_protection: 'paladin-protection',
  paladin_retribution: 'paladin-retribution',
  priest_discipline: 'priest-discipline',
  priest_holy: 'priest-holy',
  priest_shadow: 'priest-shadow',
  rogue_assassination: 'rogue-assassination',
  rogue_outlaw: 'rogue-outlaw',
  rogue_subtlety: 'rogue-subtlety',
  shaman_elemental: 'shaman-elemental',
  shaman_enhancement: 'shaman-enhancement',
  shaman_restoration: 'shaman-restoration',
  warlock_affliction: 'warlock-affliction',
  warlock_demonology: 'warlock-demonology',
  warlock_destruction: 'warlock-destruction',
  warrior_arms: 'warrior-arms',
  warrior_fury: 'warrior-fury',
  warrior_protection: 'warrior-protection',
};
