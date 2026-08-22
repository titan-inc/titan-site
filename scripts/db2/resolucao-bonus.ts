import type { DatabaseSync } from 'node:sqlite';

/**
 * PASSO 1 do gerador — "RESOLVER OS BÔNUS", antes de qualquer conta. É onde
 * mora o achado mais caro da pesquisa: o `itemString` de um drop NÃO é a
 * fonte completa. Ver "O `itemString` NÃO é a fonte completa" em
 * `docs/db2-do-cliente.md`.
 *
 * O gerador não tem `itemString` nenhum — ele nunca vê um drop real, só o
 * catálogo. O que ele produz é o que falta para o carregador (TIT-140)
 * completar a união depois, quando um `itemString` de verdade aparecer:
 *
 *   bônus aplicados = bônus do itemString  ∪  nós da árvore com ItemContext
 *                                              igual ao do item
 *
 * A metade direita dessa união, para TODO `itemContext` que o item pode
 * assumir, é a tabela `contextos` (`WowItemContextBonus`). A metade esquerda
 * (o que um `itemString` real pode citar) vem só em runtime.
 */

interface NoArvoreBruto {
  ID: number;
  ItemContext: number;
  ChildItemBonusTreeID: number;
  ChildItemBonusListID: number;
  ChildItemBonusListGroupID: number;
  ChildItemLevelSelectorID: number;
  ParentItemBonusTreeID: number;
}

interface EntradaGrupoBruta {
  ItemBonusListGroupID: number;
  ItemBonusListID: number;
  SequenceValue: number;
}

export interface AvisoItemLevelSelector {
  itemId: number;
  noId: number;
  itemContext: number;
}

export interface ResultadoResolucaoBonus {
  /** itemId → itemContext → conjunto de bonusId aplicados NESSE contexto. */
  contextosPorItem: Map<number, Map<number, Set<number>>>;

  /**
   * Todo bonusId que a árvore de QUALQUER item do catálogo alcançou — inclui
   * os nós `ctx 0` (o "cardápio": terciário, socket), que nunca entram em
   * `contextosPorItem` mas ainda assim precisam de linha em `WowBonus`,
   * porque um drop real pode trazer qualquer opção do cardápio no
   * `itemString`. É o conjunto que popula `bonuses`.
   */
  bonusIdsAlcancados: Set<number>;

  /**
   * `ChildItemLevelSelectorID` não é resolvido (pergunta aberta, ver
   * "Aberto e conhecido" em `docs/db2-do-cliente.md`). Um nó APLICADO
   * (`ItemContext != 0`) que o carregue é aviso, nunca falha dura — nenhum
   * espécime da fixture passa por lá, mas silenciar seria o mesmo erro que
   * já aconteceu com o `Type 50`.
   */
  avisosItemLevelSelector: AvisoItemLevelSelector[];
}

export function resolverArvoreDeBonus(
  db: DatabaseSync,
  itemIds: number[],
): ResultadoResolucaoBonus {
  const nosPorArvore = carregarNosPorArvore(db);
  const entradasPorGrupo = carregarEntradasPorGrupo(db);
  const arvoresPorItem = carregarArvoresPorItem(db, itemIds);

  const contextosPorItem = new Map<number, Map<number, Set<number>>>();
  const bonusIdsAlcancados = new Set<number>();
  const avisosItemLevelSelector: AvisoItemLevelSelector[] = [];

  for (const itemId of itemIds) {
    const raizes = arvoresPorItem.get(itemId) ?? [];
    if (raizes.length === 0) continue;

    const contextosDoItem = new Map<number, Set<number>>();
    contextosPorItem.set(itemId, contextosDoItem);

    const arvoresVisitadas = new Set<number>();
    const pilha = [...raizes];

    while (pilha.length > 0) {
      const arvoreId = pilha.pop()!;
      if (arvoresVisitadas.has(arvoreId)) continue;
      arvoresVisitadas.add(arvoreId);

      for (const no of nosPorArvore.get(arvoreId) ?? []) {
        processarNo(
          no,
          itemId,
          entradasPorGrupo,
          contextosDoItem,
          bonusIdsAlcancados,
          avisosItemLevelSelector,
        );

        // Descer é incondicional — em QUALQUER contexto, inclusive ctx 0.
        // Filtrar aqui é o erro que já aconteceu: a árvore devolve vazio.
        if (no.ChildItemBonusTreeID !== 0) {
          pilha.push(no.ChildItemBonusTreeID);
        }
      }
    }
  }

  return { contextosPorItem, bonusIdsAlcancados, avisosItemLevelSelector };
}

function processarNo(
  no: NoArvoreBruto,
  itemId: number,
  entradasPorGrupo: Map<number, EntradaGrupoBruta[]>,
  contextosDoItem: Map<number, Set<number>>,
  bonusIdsAlcancados: Set<number>,
  avisosItemLevelSelector: AvisoItemLevelSelector[],
): void {
  // Aplicar é só ctx == contexto real do item — e o gerador não conhece o
  // contexto real de drop nenhum, só os que a árvore descreve. ctx 0 é o
  // marcador de "cardápio" (opção, nunca aplicado) — ver a seção "A árvore é
  // um CARDÁPIO" da doc.
  const aplicavel = no.ItemContext !== 0;

  if (no.ChildItemBonusListID !== 0) {
    bonusIdsAlcancados.add(no.ChildItemBonusListID);
    if (aplicavel) {
      adicionarContexto(contextosDoItem, no.ItemContext, no.ChildItemBonusListID);
    }
  }

  if (no.ChildItemBonusListGroupID !== 0) {
    const entradas = entradasPorGrupo.get(no.ChildItemBonusListGroupID) ?? [];
    // TODAS as ranks do grupo viram bonusId de WowBonus — um itemString real
    // pode citar qualquer uma. Só a rank 1 (padrão) é "aplicada" sem que o
    // itemString diga o rank explicitamente (Type 34 ausente).
    let rankPadrao: EntradaGrupoBruta | undefined;
    for (const entrada of entradas) {
      bonusIdsAlcancados.add(entrada.ItemBonusListID);
      if (entrada.SequenceValue === 1) rankPadrao = entrada;
    }
    if (aplicavel && rankPadrao) {
      adicionarContexto(contextosDoItem, no.ItemContext, rankPadrao.ItemBonusListID);
    }
  }

  if (aplicavel && no.ChildItemLevelSelectorID !== 0) {
    avisosItemLevelSelector.push({ itemId, noId: no.ID, itemContext: no.ItemContext });
  }
}

function adicionarContexto(
  contextosDoItem: Map<number, Set<number>>,
  itemContext: number,
  bonusId: number,
): void {
  let conjunto = contextosDoItem.get(itemContext);
  if (!conjunto) {
    conjunto = new Set();
    contextosDoItem.set(itemContext, conjunto);
  }
  conjunto.add(bonusId);
}

function carregarNosPorArvore(db: DatabaseSync): Map<number, NoArvoreBruto[]> {
  const linhas = db
    .prepare(
      `SELECT ID, ItemContext, ChildItemBonusTreeID, ChildItemBonusListID,
              ChildItemBonusListGroupID, ChildItemLevelSelectorID, ParentItemBonusTreeID
       FROM ItemBonusTreeNode`,
    )
    .all() as unknown as NoArvoreBruto[];

  const porArvore = new Map<number, NoArvoreBruto[]>();
  for (const linha of linhas) {
    let lista = porArvore.get(linha.ParentItemBonusTreeID);
    if (!lista) {
      lista = [];
      porArvore.set(linha.ParentItemBonusTreeID, lista);
    }
    lista.push(linha);
  }
  return porArvore;
}

function carregarEntradasPorGrupo(db: DatabaseSync): Map<number, EntradaGrupoBruta[]> {
  const linhas = db
    .prepare(
      `SELECT ItemBonusListGroupID, ItemBonusListID, SequenceValue FROM ItemBonusListGroupEntry`,
    )
    .all() as unknown as EntradaGrupoBruta[];

  const porGrupo = new Map<number, EntradaGrupoBruta[]>();
  for (const linha of linhas) {
    let lista = porGrupo.get(linha.ItemBonusListGroupID);
    if (!lista) {
      lista = [];
      porGrupo.set(linha.ItemBonusListGroupID, lista);
    }
    lista.push(linha);
  }
  return porGrupo;
}

function carregarArvoresPorItem(db: DatabaseSync, itemIds: number[]): Map<number, number[]> {
  const porItem = new Map<number, number[]>();
  const placeholders = itemIds.map(() => '?').join(',');
  const linhas = db
    .prepare(`SELECT ItemID, ItemBonusTreeID FROM ItemXBonusTree WHERE ItemID IN (${placeholders})`)
    .all(...itemIds) as unknown as Array<{ ItemID: number; ItemBonusTreeID: number }>;

  for (const linha of linhas) {
    let lista = porItem.get(linha.ItemID);
    if (!lista) {
      lista = [];
      porItem.set(linha.ItemID, lista);
    }
    lista.push(linha.ItemBonusTreeID);
  }
  return porItem;
}
