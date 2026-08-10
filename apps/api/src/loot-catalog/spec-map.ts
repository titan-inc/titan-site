import type { WowSpec as PrismaWowSpec } from '@prisma/client';
import { SPECS, type WowSpec } from '@titan/shared';

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
  death_knight_blood: SPECS.DEATH_KNIGHT_BLOOD,
  death_knight_frost: SPECS.DEATH_KNIGHT_FROST,
  death_knight_unholy: SPECS.DEATH_KNIGHT_UNHOLY,
  demon_hunter_devourer: SPECS.DEMON_HUNTER_DEVOURER,
  demon_hunter_havoc: SPECS.DEMON_HUNTER_HAVOC,
  demon_hunter_vengeance: SPECS.DEMON_HUNTER_VENGEANCE,
  druid_balance: SPECS.DRUID_BALANCE,
  druid_feral: SPECS.DRUID_FERAL,
  druid_guardian: SPECS.DRUID_GUARDIAN,
  druid_restoration: SPECS.DRUID_RESTORATION,
  evoker_augmentation: SPECS.EVOKER_AUGMENTATION,
  evoker_devastation: SPECS.EVOKER_DEVASTATION,
  evoker_preservation: SPECS.EVOKER_PRESERVATION,
  hunter_beast_mastery: SPECS.HUNTER_BEAST_MASTERY,
  hunter_marksmanship: SPECS.HUNTER_MARKSMANSHIP,
  hunter_survival: SPECS.HUNTER_SURVIVAL,
  mage_arcane: SPECS.MAGE_ARCANE,
  mage_fire: SPECS.MAGE_FIRE,
  mage_frost: SPECS.MAGE_FROST,
  monk_brewmaster: SPECS.MONK_BREWMASTER,
  monk_mistweaver: SPECS.MONK_MISTWEAVER,
  monk_windwalker: SPECS.MONK_WINDWALKER,
  paladin_holy: SPECS.PALADIN_HOLY,
  paladin_protection: SPECS.PALADIN_PROTECTION,
  paladin_retribution: SPECS.PALADIN_RETRIBUTION,
  priest_discipline: SPECS.PRIEST_DISCIPLINE,
  priest_holy: SPECS.PRIEST_HOLY,
  priest_shadow: SPECS.PRIEST_SHADOW,
  rogue_assassination: SPECS.ROGUE_ASSASSINATION,
  rogue_outlaw: SPECS.ROGUE_OUTLAW,
  rogue_subtlety: SPECS.ROGUE_SUBTLETY,
  shaman_elemental: SPECS.SHAMAN_ELEMENTAL,
  shaman_enhancement: SPECS.SHAMAN_ENHANCEMENT,
  shaman_restoration: SPECS.SHAMAN_RESTORATION,
  warlock_affliction: SPECS.WARLOCK_AFFLICTION,
  warlock_demonology: SPECS.WARLOCK_DEMONOLOGY,
  warlock_destruction: SPECS.WARLOCK_DESTRUCTION,
  warrior_arms: SPECS.WARRIOR_ARMS,
  warrior_fury: SPECS.WARRIOR_FURY,
  warrior_protection: SPECS.WARRIOR_PROTECTION,
};

/**
 * O caminho inverso: slug do contrato para o enum do banco.
 *
 * Derivado do `SPEC_FROM_DB`, e não escrito à mão de novo. Duas listas de 39
 * entradas mantidas em paralelo divergem, e a segunda não teria como ser
 * verificada pelo compilador — enquanto esta é a inversão de um mapa que o
 * `Record<PrismaWowSpec, WowSpec>` já obriga a estar completo, e cujos valores
 * são slugs distintos entre si.
 *
 * Precisa vir DEPOIS do `SPEC_FROM_DB`: ele é lido em tempo de carga do módulo.
 */
export const SPEC_TO_DB = Object.fromEntries(
  Object.entries(SPEC_FROM_DB).map(([doBanco, slug]) => [slug, doBanco]),
) as Record<WowSpec, PrismaWowSpec>;
