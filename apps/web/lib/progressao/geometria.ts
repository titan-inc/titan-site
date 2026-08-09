import {
  killedInDifficulty,
  type BossProgress,
  type RaidProgress,
  type RaidProgressReport,
} from '@titan/shared';

export interface LeituraBoss {
  morto: boolean;
  pulls: number;
  melhorPercentual: number | null;
  primeiraKill: string | null;
}

export function escolherDificuldade(report: RaidProgressReport): number {
  if (!report.difficulties.length) return -1;
  const comKill = report.difficulties.filter((dificuldade) =>
    report.raids.some((raid) => killedInDifficulty(raid, dificuldade.id).killed > 0),
  );
  return Math.max(
    ...(comKill.length ? comKill : report.difficulties).map((dificuldade) => dificuldade.id),
  );
}

function ultimaKill(raid: RaidProgress, dificuldade: number): number {
  return Math.max(
    0,
    ...raid.bosses.flatMap((boss) =>
      boss.byDifficulty
        .filter((linha) => linha.difficulty === dificuldade && linha.firstKillAt)
        .map((linha) => Date.parse(linha.firstKillAt!)),
    ),
  );
}

export function escolherRaid(report: RaidProgressReport, dificuldade: number): RaidProgress | null {
  return (
    report.raids
      .filter((raid) => raid.id !== null)
      .map((raid, ordem) => ({
        raid,
        ordem,
        kills: killedInDifficulty(raid, dificuldade).killed,
        ultima: ultimaKill(raid, dificuldade),
      }))
      .sort((a, b) => b.kills - a.kills || b.ultima - a.ultima || a.ordem - b.ordem)[0]?.raid ??
    null
  );
}

export function lerBoss(boss: BossProgress, dificuldade: number): LeituraBoss {
  const linha = boss.byDifficulty.find((item) => item.difficulty === dificuldade);
  return {
    morto: Boolean(linha && linha.kills > 0),
    pulls: linha?.pulls ?? 0,
    melhorPercentual: linha?.bestPercent ?? null,
    primeiraKill: linha?.firstKillAt ?? null,
  };
}
