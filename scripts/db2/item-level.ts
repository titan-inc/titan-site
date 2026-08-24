import type { DatabaseSync } from 'node:sqlite';
import { paraArrayNumerico } from './wow-export-db.js';

/**
 * O item level dos itens modernos — `Type 49` (`SCALE_CONFIG`), com `Type 50`
 * (`APPLY_BONUS`) recursivo quando a lista não traz o `Type 49` ela mesma.
 * Ver "O item level dos itens modernos" e "O `Type 50` aponta para OUTRA
 * lista" em `docs/db2-do-cliente.md`.
 *
 * ```
 * ilvl = round( curve_point_value( CurveID, ItemScalingConfig.ItemLevel ) ) + Offset
 * ```
 *
 * ## Dois achados que NÃO estão em `docs/db2-do-cliente.md` — evidência abaixo
 *
 * Achados durante a auto-conferência desta issue (TIT-139), fechando o
 * `Ancient Amani Greataxe` e o par `Tarnished Dawnlit`. Ficam registrados
 * aqui porque o doc-fonte não os cobre; ao atualizá-lo, mover para lá.
 *
 * **1. Duas listas do MESMO itemString podem carregar `Type 49`.** O
 * `Ancient Amani Greataxe` tem `13844` (`Value "449,1,0,0"`, config 449 →
 * ilvl 256) E `13845` (`Value "450,0,0,0"`, config 450 → ilvl 263, esperado
 * pelo tooltip). O segundo elemento do `Value` distingue as duas — `0` é a
 * config que vale, `1` não. Uma fixture só não prova regra geral; registrado
 * como o que a evidência sustenta.
 *
 * **2. `Type 51` (`SCALE_CONFIG_2`) é canal alternativo ao `Type 49`, e
 * `ItemScalingConfig.ItemLevel = 0` muda o eixo da curva.** O par
 * `Tarnished Dawnlit` (`Type 51`, `Value "481,1,0,0"`, config 481) tem
 * `ItemLevel = 0` — não é "sem ilvl", é sinal de que a curva (`CurveID
 * 109495`, via `ItemOffsetCurveID 66`) não é indexada por item level: seus
 * `Pos` são níveis de PERSONAGEM (70..100), com plateau em `(90, 253)` — e
 * 253 é exatamente o ilvl que o tooltip mostra. Como o popover renderiza sem
 * personagem (Regra 4/Regra do CLAUDE.md), o nível usado é o de personagem
 * MÁXIMO (90), não o nível do `itemString` de quem coletou (81 no espécime).
 */
const NIVEL_PERSONAGEM_MAX_PARA_CURVA = 90;

interface LinhaItemBonus {
  Type: number;
  Value: string;
  ParentItemBonusListID: number;
}

interface ConfigEscalonamento {
  itemOffsetCurveID: number;
  itemLevel: number;
}

interface OffsetCurva {
  curveID: number;
  offset: number;
}

interface PontoCurva {
  pos: number;
  valor: number;
}

export class ResolvedorItemLevel {
  private readonly bonusPorLista: Map<number, LinhaItemBonus[]>;
  private readonly configPorId: Map<number, ConfigEscalonamento>;
  private readonly offsetPorId: Map<number, OffsetCurva>;
  private readonly pontosPorCurva: Map<number, PontoCurva[]>;

  constructor(db: DatabaseSync) {
    this.bonusPorLista = agruparPorLista(
      db
        .prepare('SELECT ParentItemBonusListID, Type, Value FROM ItemBonus')
        .all() as unknown as LinhaItemBonus[],
    );

    this.configPorId = new Map(
      (
        db
          .prepare('SELECT ID, ItemOffsetCurveID, ItemLevel FROM ItemScalingConfig')
          .all() as unknown as Array<{
          ID: number;
          ItemOffsetCurveID: number;
          ItemLevel: number;
        }>
      ).map((linha) => [
        linha.ID,
        { itemOffsetCurveID: linha.ItemOffsetCurveID, itemLevel: linha.ItemLevel },
      ]),
    );

    this.offsetPorId = new Map(
      (
        db.prepare('SELECT ID, CurveID, Offset FROM ItemOffsetCurve').all() as unknown as Array<{
          ID: number;
          CurveID: number;
          Offset: number;
        }>
      ).map((linha) => [linha.ID, { curveID: linha.CurveID, offset: linha.Offset }]),
    );

    const pontosBrutos = db
      .prepare('SELECT CurveID, Pos, OrderIndex FROM CurvePoint ORDER BY CurveID, OrderIndex')
      .all() as unknown as Array<{
      CurveID: number;
      Pos: string;
      OrderIndex: number;
    }>;
    this.pontosPorCurva = new Map();
    for (const linha of pontosBrutos) {
      const [x, y] = paraArrayNumerico(linha.Pos);
      let lista = this.pontosPorCurva.get(linha.CurveID);
      if (!lista) {
        lista = [];
        this.pontosPorCurva.set(linha.CurveID, lista);
      }
      lista.push({ pos: x ?? 0, valor: y ?? 0 });
    }
  }

  /**
   * O item level que a lista de bônus `bonusId` determina, ou `null` se ela
   * não mexe em ilvl. Expande `Type 50` recursivamente, com proteção contra
   * ciclo — a mesma lista nunca é revisitada.
   */
  resolver(bonusId: number, visitados = new Set<number>()): number | null {
    return this.resolverComConfianca(bonusId, visitados)?.ilvl ?? null;
  }

  /**
   * Igual a `resolver`, mas também diz se o `Type 49`/`51` usado é o
   * "confiável" (segundo valor do `Value` igual a 0) — ver o achado do
   * Ancient Amani Greataxe no topo do arquivo. Quando o MESMO item tem duas
   * listas de bônus concorrendo pelo ilvl (caso raro, um item só na fixture),
   * quem chama compara a confiança entre elas; uma lista sozinha não sabe
   * que está competindo.
   */
  resolverComConfianca(
    bonusId: number,
    visitados = new Set<number>(),
  ): { ilvl: number; confiavel: boolean; marcador: number } | null {
    if (visitados.has(bonusId)) return null;
    visitados.add(bonusId);

    const linhas = this.bonusPorLista.get(bonusId) ?? [];

    // Type 49 (SCALE_CONFIG) e Type 51 (SCALE_CONFIG_2) são dois canais para
    // a mesma coisa — mesmo formato de Value, mesma tabela de config.
    const configLinha = linhas.find((l) => l.Type === 49 || l.Type === 51);
    if (configLinha) {
      const [configId, marcador] = configLinha.Value.split(',').map(Number);
      // configId 0: achado ampliando bonuses pra todo bonusId do build (PR
      // #98) — 1 de 541 linhas Type49/51, isolada (não alcançável por nó de
      // árvore nem por grupo). ItemScalingConfig.ID começa em 1, então 0
      // nunca existiria mesmo com a extração completa; tratar como "sem
      // config" em vez de falha dura — diferente de um id positivo ausente,
      // que continua sendo extração incompleta.
      if (configId === 0) return null;

      // `marcador` vai CRU para o banco, além do booleano derivado: um
      // espécime só não prova o enum inteiro do campo, e um `2` que apareça
      // amanhã seria achatado em `1` se só o booleano sobrevivesse.
      const cru = marcador ?? 0;
      return { ilvl: this.resolverPelaConfig(configId!), confiavel: cru === 0, marcador: cru };
    }

    const type50 = linhas.find((l) => l.Type === 50);
    if (type50) {
      const listaAlvo = Number(type50.Value.split(',')[0]);
      return this.resolverComConfianca(listaAlvo, visitados);
    }

    return null;
  }

  private resolverPelaConfig(configId: number): number {
    const config = this.configPorId.get(configId);
    if (!config) {
      throw new Error(
        `ItemScalingConfig ${configId} não existe no dump — extração incompleta (ver docs/db2-do-cliente.md).`,
      );
    }

    const offset = this.offsetPorId.get(config.itemOffsetCurveID);
    if (!offset) {
      throw new Error(
        `ItemOffsetCurve ${config.itemOffsetCurveID} não existe no dump — extração incompleta.`,
      );
    }

    const pontos = this.pontosPorCurva.get(offset.curveID);
    if (!pontos || pontos.length === 0) {
      throw new Error(
        `CurvePoint para CurveID ${offset.curveID} não existe no dump — extração incompleta.`,
      );
    }

    // ItemLevel 0 é sinal de curva indexada por nível de PERSONAGEM, não por
    // item level — ver o comentário do topo do arquivo (achado do Tarnished
    // Dawnlit). Sem personagem, usa o nível máximo.
    const entrada = config.itemLevel === 0 ? NIVEL_PERSONAGEM_MAX_PARA_CURVA : config.itemLevel;

    return Math.round(interpolarCurva(pontos, entrada)) + offset.offset;
  }
}

function interpolarCurva(pontos: PontoCurva[], x: number): number {
  const primeiro = pontos[0]!;
  const ultimo = pontos[pontos.length - 1]!;
  if (x <= primeiro.pos) return primeiro.valor;
  if (x >= ultimo.pos) return ultimo.valor;

  for (let i = 0; i < pontos.length - 1; i++) {
    const a = pontos[i]!;
    const b = pontos[i + 1]!;
    if (x >= a.pos && x <= b.pos) {
      const t = (x - a.pos) / (b.pos - a.pos);
      return a.valor + t * (b.valor - a.valor);
    }
  }
  // Inalcançável dado o clamp acima, mas o compilador não sabe disso.
  throw new Error(`x=${x} fora do domínio dos pontos da curva`);
}

function agruparPorLista(linhas: LinhaItemBonus[]): Map<number, LinhaItemBonus[]> {
  const mapa = new Map<number, LinhaItemBonus[]>();
  for (const linha of linhas) {
    let lista = mapa.get(linha.ParentItemBonusListID);
    if (!lista) {
      lista = [];
      mapa.set(linha.ParentItemBonusListID, lista);
    }
    lista.push(linha);
  }
  return mapa;
}
