import type { RaidProgressReport } from '@titan/shared';
import { escolherDificuldade, lerBoss } from './geometria';
import { siglaDificuldade, siglaRaid } from './sigla';

export interface ResumoProgressaoNav {
  /** Nomes completos das raids da season, na ordem do tier. Vai no `title` e no `sr-only`. */
  raidNome: string;
  /** Siglas separadas por barra. Forma curta para a navbar — ver `sigla.ts`. */
  raidSigla: string;
  dificuldadeNome: string;
  dificuldadeSigla: string;
  /** Soma de todas as raids da season, não de uma escolhida. */
  vencidos: number;
  total: number;
  estados: readonly boolean[];
  desenvolvimento: boolean;
}

/**
 * Resume a progressão do tier para a régua da navbar.
 *
 * **Soma todas as raids da season, não escolhe uma.** Uma season pode ter mais
 * de uma raid aberta ao mesmo tempo — a de 12.0 tem quatro — e mostrar só a de
 * maior progresso dava um número que não é a progressão da guilda: `6/6` parece
 * tier fechado quando na verdade faltam bosses em outra raid.
 *
 * Por isso `escolherRaid()` não é usado aqui. Ele continua servindo a área
 * interna, onde a leitura é por raid e faz sentido destacar uma.
 *
 * As raids entram na ordem do relatório, que é a ordem do tier, e não ordenadas
 * por progresso: ordem que muda quando a guilda mata um boss faz a barra
 * reorganizar sozinha entre duas visitas.
 */
export function resumirProgressaoNav(
  report: RaidProgressReport | null,
  desenvolvimento = false,
): ResumoProgressaoNav | null {
  if (!report) return null;

  const dificuldade = escolherDificuldade(report);
  if (dificuldade < 0) return null;

  const dificuldadeLida = report.difficulties.find((item) => item.id === dificuldade)?.name.trim();
  if (!dificuldadeLida) return null;

  // `id` nulo é raid que o catálogo não reconheceu; sem bosses não há o que
  // somar. Nos dois casos a linha não representa progressão.
  const raids = report.raids.filter((raid) => raid.id !== null && raid.bosses.length > 0);
  if (raids.length === 0) return null;

  const estados = raids.flatMap((raid) =>
    raid.bosses.map((boss) => lerBoss(boss, dificuldade).morto),
  );

  const nomeDificuldade =
    desenvolvimento && dificuldadeLida === 'Mythic' ? 'Mítico' : dificuldadeLida;

  return {
    raidNome: raids.map((raid) => raid.name.trim()).join(', '),
    raidSigla: raids.map((raid) => siglaRaid(raid.name)).join(' / '),
    dificuldadeNome: nomeDificuldade,
    dificuldadeSigla: siglaDificuldade(nomeDificuldade),
    vencidos: estados.filter(Boolean).length,
    total: estados.length,
    estados,
    desenvolvimento,
  };
}
