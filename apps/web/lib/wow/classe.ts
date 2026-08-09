/**
 * Cores oficiais de classe do WoW.
 *
 * Chaveadas em forma normalizada porque `RosterEntry.wowClass` é string crua
 * do WoWAudit ("Death Knight"), não o enum `wowClassSchema` — ver o comentário
 * de `packages/shared/src/roster.ts`.
 *
 * Mora no front, e não em `packages/shared`, apesar da Regra 2: cor de classe é
 * apresentação, não contrato. Nenhum DTO a carrega e o Nest nunca a valida.
 */
const CORES: Record<string, string> = {
  'death-knight': '#C41E3A',
  'demon-hunter': '#A330C9',
  druid: '#FF7C0A',
  evoker: '#33937F',
  hunter: '#AAD372',
  mage: '#3FC7EB',
  monk: '#00FF98',
  paladin: '#F48CBA',
  priest: '#FFFFFF',
  rogue: '#FFF468',
  shaman: '#0070DD',
  warlock: '#8788EE',
  warrior: '#C69B6D',
};

/**
 * Normalização local, **não** `toSlug()` do shared.
 *
 * Regra 6 reserva `toSlug()` para realm e para nome digitado por pessoa. Usar
 * aqui seria erro de categoria, e um dia alguém muda `toSlug()` por um motivo
 * de realm e quebra cor de classe sem relação nenhuma.
 */
function normalizar(bruto: string): string {
  return bruto.trim().toLowerCase().replace(/\s+/g, '-');
}

/** `null` quando a grafia não é reconhecida. Nunca lança, nunca adivinha. */
export function corDaClasse(wowClass: string): string | null {
  return CORES[normalizar(wowClass)] ?? null;
}
