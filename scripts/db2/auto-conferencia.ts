import type { DatabaseSync } from 'node:sqlite';
import { paraArrayNumerico } from './wow-export-db.js';
import type { LinhaEscala } from './montar-escalas.js';
import { ResolvedorItemLevel } from './item-level.js';
import { resolverArvoreDeBonus } from './resolucao-bonus.js';
import { resolverBudgetIndex, resolverTipoOrcamento } from './orcamento.js';
import { calcularValorStat } from './formula-stat.js';
import { carregarFixture, type EspecimeFixture } from './fixture.js';

/**
 * O CORAÇÃO DA ISSUE (TIT-139): roda a fixture contra o dump a cada geração.
 * Se um espécime não fecha, o gerador se recusa a emitir o arquivo — sem
 * flag de pular. Ver "Como ele se confere" na issue.
 *
 * Escopo desta rodada: item level + os valores de stat (primário, stamina,
 * secundários, terciários — os 73 valores que a fixture cobre com mais
 * densidade). Armadura, dano de arma, `Block`, track e texto entram em
 * checkpoints seguintes.
 */

/** statId → nome canônico. Primário flexível (71-74) fica de fora — não tem
 * nome fixo, é resolvido contra `esperado.primario.tipos` na comparação. */
const NOME_POR_STAT_ID: Record<number, string> = {
  3: 'agility',
  4: 'strength',
  5: 'intellect',
  7: 'stamina',
  32: 'crit',
  36: 'haste',
  40: 'versatility',
  49: 'mastery',
  61: 'speed',
  62: 'leech',
  63: 'avoidance',
  64: 'indestructible',
};
const IDS_PRIMARIO_FLEXIVEL = new Set([71, 72, 73, 74]);

export interface DivergenciaFixture {
  especime: string;
  campo: string;
  esperado: unknown;
  calculado: unknown;
}

export interface ResultadoAutoConferencia {
  valoresConferidos: number;
  divergencias: DivergenciaFixture[];
}

export function rodarAutoConferencia(
  db: DatabaseSync,
  escalasPorIlvl: Map<number, LinhaEscala>,
  caminhoFixture: string,
): ResultadoAutoConferencia {
  const especimes = carregarFixture(caminhoFixture);
  const itemIds = [...new Set(especimes.map((e) => e.itemId))];

  const arvore = resolverArvoreDeBonus(db, itemIds);
  const itemLevelResolver = new ResolvedorItemLevel(db);
  const itemSparsePorId = carregarItemSparse(db, itemIds);
  const statsExtrasPorBonus = carregarStatsAdicionaisPorBonus(db);

  const divergencias: DivergenciaFixture[] = [];
  let valoresConferidos = 0;

  for (const especime of especimes) {
    if (especime.contaminado) continue; // "NÃO usar para calibrar stat" — a doc é explícita.

    const item = itemSparsePorId.get(especime.itemId);
    if (!item) {
      divergencias.push({
        especime: especime.nome,
        campo: 'ItemSparse',
        esperado: 'presente',
        calculado: 'ausente no dump',
      });
      continue;
    }

    const bonusAplicados = uniaoDeBonus(especime, arvore.contextosPorItem.get(especime.itemId));
    const ilvl = resolverIlvlDoEspecime(bonusAplicados, itemLevelResolver, item.itemLevel);
    conferir(divergencias, especime.nome, 'itemLevel', especime.itemLevelEsperado, ilvl);
    valoresConferidos++;

    const escala = escalasPorIlvl.get(ilvl);
    if (!escala) {
      divergencias.push({
        especime: especime.nome,
        campo: 'escalas',
        esperado: `linha ilvl ${ilvl}`,
        calculado: 'ausente',
      });
      continue;
    }

    const idx = resolverBudgetIndex(item.inventoryType);
    const tipo = resolverTipoOrcamento(item.inventoryType);
    const statsExtras = bonusAplicados.flatMap((bonusId) => statsExtrasPorBonus.get(bonusId) ?? []);
    const computado = calcularStatsDoItem(item, statsExtras, idx, tipo, escala);

    valoresConferidos += conferirStats(divergencias, especime, computado);
  }

  return { valoresConferidos, divergencias };
}

function conferir(
  divergencias: DivergenciaFixture[],
  especime: string,
  campo: string,
  esperado: unknown,
  calculado: unknown,
): void {
  if (esperado !== calculado) {
    divergencias.push({ especime, campo, esperado, calculado });
  }
}

/** bônus do itemString ∪ nós da árvore com ItemContext igual — a regra da TIT-139/doc. */
function uniaoDeBonus(
  especime: EspecimeFixture,
  contextosDoItem: Map<number, Set<number>> | undefined,
): number[] {
  const daArvore = contextosDoItem?.get(especime.itemContext) ?? new Set<number>();
  return [...new Set([...especime.bonusIds, ...daArvore])];
}

/**
 * Normalmente só uma lista do union carrega `Type 49`/`51`. Quando mais de
 * uma carrega (visto uma vez, no Ancient Amani Greataxe — duas listas do
 * MESMO itemString competindo), a "confiável" vence; ver o comentário no
 * topo de `item-level.ts`.
 */
function resolverIlvlDoEspecime(
  bonusAplicados: number[],
  resolver: ResolvedorItemLevel,
  ilvlBase: number,
): number {
  let candidato: { ilvl: number; confiavel: boolean } | null = null;
  for (const bonusId of bonusAplicados) {
    const resolvido = resolver.resolverComConfianca(bonusId);
    if (!resolvido) continue;
    if (!candidato || (resolvido.confiavel && !candidato.confiavel)) {
      candidato = resolvido;
    }
  }
  return candidato?.ilvl ?? ilvlBase;
}

function calcularStatsDoItem(
  item: ItemSparseResumo,
  statsExtras: StatAdicional[],
  idx: number,
  tipo: ReturnType<typeof resolverTipoOrcamento>,
  escala: LinhaEscala,
): { porNome: Map<string, number>; flexivelPrimario: number | null } {
  const agrupado = agruparAlocacoesPorStat(item.statIds, item.statAllocs, item.socketAllocs);
  // Terciário (e qualquer outro "Type 2" do bônus) não mora no ItemSparse —
  // é o bônus que ACRESCENTA a entrada de stat. Sem socket associado.
  for (const extra of statsExtras) {
    const atual = agrupado.get(extra.statId) ?? { alocacao: 0, alocacaoSocket: 0 };
    atual.alocacao += extra.alocacao;
    agrupado.set(extra.statId, atual);
  }

  const porNome = new Map<string, number>();
  let flexivelPrimario: number | null = null;

  for (const [statId, { alocacao, alocacaoSocket }] of agrupado) {
    if (statId < 0) continue;
    const valor = calcularValorStat(statId, alocacao, alocacaoSocket, idx, tipo, escala);
    if (IDS_PRIMARIO_FLEXIVEL.has(statId)) {
      flexivelPrimario = valor;
    } else {
      const nome = NOME_POR_STAT_ID[statId];
      if (nome) porNome.set(nome, valor);
    }
  }

  return { porNome, flexivelPrimario };
}

/** Um stat pode aparecer duas vezes no `ItemSparse` — as alocações somam
 * ANTES da fórmula (ver "Um stat que aparece duas vezes SOMA" na doc). */
function agruparAlocacoesPorStat(
  statIds: number[],
  statAllocs: number[],
  socketAllocs: number[],
): Map<number, { alocacao: number; alocacaoSocket: number }> {
  const agrupado = new Map<number, { alocacao: number; alocacaoSocket: number }>();
  for (let i = 0; i < statIds.length; i++) {
    const statId = statIds[i]!;
    if (statId < 0) continue;
    const atual = agrupado.get(statId) ?? { alocacao: 0, alocacaoSocket: 0 };
    atual.alocacao += statAllocs[i] ?? 0;
    atual.alocacaoSocket += socketAllocs[i] ?? 0;
    agrupado.set(statId, atual);
  }
  return agrupado;
}

function conferirStats(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  computado: { porNome: Map<string, number>; flexivelPrimario: number | null },
): number {
  let conferidos = 0;
  const { esperado } = especime;

  // Chaves que pertencem a checkpoints futuros (armadura, dano de arma,
  // Block, texto) — ignoradas aqui de propósito, não são "não encontradas".
  const FORA_DE_ESCOPO = new Set(['armadura', 'danoMin', 'danoMax', 'dps', 'block']);
  const ehArma = 'danoMin' in esperado;

  for (const [campo, valorEsperado] of Object.entries(esperado)) {
    if (FORA_DE_ESCOPO.has(campo)) continue;
    if (campo === 'speed' && ehArma) continue; // "speed" de arma é velocidade, não o terciário.

    if (campo === 'primario') {
      const esperadoObj = valorEsperado as number | { valor: number; tipos: string[] };
      const valorPrimario = typeof esperadoObj === 'number' ? esperadoObj : esperadoObj.valor;
      const tipos = typeof esperadoObj === 'number' ? [] : esperadoObj.tipos;
      const calculado =
        computado.flexivelPrimario ?? computado.porNome.get(tipos[0]?.toLowerCase() ?? '');
      conferir(divergencias, especime.nome, 'primario', valorPrimario, calculado);
      conferidos++;
      continue;
    }

    if (typeof valorEsperado !== 'number') continue; // não é stat (set, track, notas...)
    conferir(divergencias, especime.nome, campo, valorEsperado, computado.porNome.get(campo));
    conferidos++;
  }

  return conferidos;
}

interface StatAdicional {
  statId: number;
  alocacao: number;
}

/** `Type 2` (`MOD`, "acrescenta stat") — usado sobretudo pelos terciários
 * (bônus 40-43), mas é mecanismo genérico: qualquer bônus pode injetar uma
 * entrada de stat que não está no `ItemSparse` do item base. */
function carregarStatsAdicionaisPorBonus(db: DatabaseSync): Map<number, StatAdicional[]> {
  const linhas = db
    .prepare(`SELECT ParentItemBonusListID, Value FROM ItemBonus WHERE Type = 2`)
    .all() as unknown as Array<{ ParentItemBonusListID: number; Value: string }>;

  const porBonus = new Map<number, StatAdicional[]>();
  for (const linha of linhas) {
    const [statId, alocacao] = paraArrayNumerico(linha.Value);
    let lista = porBonus.get(linha.ParentItemBonusListID);
    if (!lista) {
      lista = [];
      porBonus.set(linha.ParentItemBonusListID, lista);
    }
    lista.push({ statId: statId ?? 0, alocacao: alocacao ?? 0 });
  }
  return porBonus;
}

interface ItemSparseResumo {
  itemLevel: number;
  inventoryType: number;
  statIds: number[];
  statAllocs: number[];
  socketAllocs: number[];
}

function carregarItemSparse(db: DatabaseSync, itemIds: number[]): Map<number, ItemSparseResumo> {
  const placeholders = itemIds.map(() => '?').join(',');
  const linhas = db
    .prepare(
      `SELECT ID, ItemLevel, InventoryType, StatModifier_bonusStat, StatPercentEditor, StatPercentageOfSocket
       FROM ItemSparse WHERE ID IN (${placeholders})`,
    )
    .all(...itemIds) as unknown as Array<{
    ID: number;
    ItemLevel: number;
    InventoryType: number;
    StatModifier_bonusStat: string;
    StatPercentEditor: string;
    StatPercentageOfSocket: string;
  }>;

  return new Map(
    linhas.map((l) => [
      l.ID,
      {
        itemLevel: l.ItemLevel,
        inventoryType: l.InventoryType,
        statIds: paraArrayNumerico(l.StatModifier_bonusStat),
        statAllocs: paraArrayNumerico(l.StatPercentEditor),
        socketAllocs: paraArrayNumerico(l.StatPercentageOfSocket),
      },
    ]),
  );
}
