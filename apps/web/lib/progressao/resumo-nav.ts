import type { RaidProgressReport } from '@titan/shared';
import { escolherDificuldade, escolherRaid, lerBoss } from './geometria';
import { siglaDificuldade, siglaRaid } from './sigla';

export interface ResumoProgressaoNav {
  raidNome: string;
  /** Forma curta para a navbar. O nome inteiro nunca coube — ver `sigla.ts`. */
  raidSigla: string;
  dificuldadeNome: string;
  dificuldadeSigla: string;
  vencidos: number;
  total: number;
  estados: readonly boolean[];
  desenvolvimento: boolean;
}

export function resumirProgressaoNav(
  report: RaidProgressReport | null,
  desenvolvimento = false,
): ResumoProgressaoNav | null {
  if (!report) return null;
  const dificuldade = escolherDificuldade(report);
  if (dificuldade < 0) return null;
  const raid = escolherRaid(report, dificuldade);
  if (!raid?.name.trim() || !raid.bosses.length) return null;
  const dificuldadeLida = report.difficulties.find((item) => item.id === dificuldade)?.name.trim();
  if (!dificuldadeLida) return null;
  const estados = raid.bosses.map((boss) => lerBoss(boss, dificuldade).morto);
  const nomeDificuldade =
    desenvolvimento && dificuldadeLida === 'Mythic' ? 'Mítico' : dificuldadeLida;
  return {
    raidNome: raid.name.trim(),
    raidSigla: siglaRaid(raid.name),
    dificuldadeNome: nomeDificuldade,
    dificuldadeSigla: siglaDificuldade(nomeDificuldade),
    vencidos: estados.filter(Boolean).length,
    total: estados.length,
    estados,
    desenvolvimento,
  };
}
