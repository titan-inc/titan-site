/**
 * "A fórmula" de `docs/db2-do-cliente.md` — reproduz os 73 de 73 valores de
 * stat da fixture, sem constante ajustada à mão:
 *
 * ```
 * budget  = RandPropPoints[ilvl].EpicF[idx]        ← a coluna FLOAT, não a INT
 * penalty = round_banqueiro( StatPercentageOfSocket[i] × ItemSocketCostPerLevel[ilvl] )
 * cru     = StatPercentEditor[i] × budget × 0,0001 − penalty
 * se combat rating:  cru ×= CombatRatingsMultByILvl[ilvl][tipo]
 * senão se stamina:  cru ×= StaminaMultByILvl[ilvl][tipo]
 * valor   = round( cru )
 * ```
 *
 * **Primário não recebe multiplicador nenhum** — não é combat rating.
 */
import type { MultiplicadorPorTipo } from './game-tables.js';
import type { TipoOrcamento } from './orcamento.js';

/** Str(4), Agi(3), Int(5) fixos + os quatro ids de primário flexível (71-74). */
const IDS_PRIMARIOS = new Set([3, 4, 5, 71, 72, 73, 74]);
const ID_STAMINA = 7;

export interface LinhaEscalaParaFormula {
  budget: number[];
  socketCost: number;
  crMult: MultiplicadorPorTipo;
  stamMult: MultiplicadorPorTipo;
}

export function ehStatPrimario(statId: number): boolean {
  return IDS_PRIMARIOS.has(statId);
}

export function calcularValorStat(
  statId: number,
  alocacao: number,
  alocacaoSocket: number,
  budgetIndex: number,
  tipoOrcamento: TipoOrcamento,
  escala: LinhaEscalaParaFormula,
): number {
  const budget = escala.budget[budgetIndex] ?? 0;
  const penalty = arredondamentoBanqueiro(alocacaoSocket * escala.socketCost);
  let cru = (alocacao * budget) / 10000 - penalty;

  if (statId === ID_STAMINA) {
    cru *= escala.stamMult[tipoOrcamento];
  } else if (!ehStatPrimario(statId)) {
    cru *= escala.crMult[tipoOrcamento];
  }
  // Primário: sem multiplicador.

  return Math.round(cru);
}

/**
 * Arredondamento bancário (half-to-even) — só usado no `penalty`, per a
 * fórmula do SimC. O `valor` final usa arredondamento normal (`Math.round`),
 * nunca truncamento (ver "Duas coisas menores" na doc).
 */
export function arredondamentoBanqueiro(x: number): number {
  const piso = Math.floor(x);
  const resto = x - piso;
  if (resto < 0.5) return piso;
  if (resto > 0.5) return piso + 1;
  return piso % 2 === 0 ? piso : piso + 1;
}
