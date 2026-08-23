import type { DatabaseSync } from 'node:sqlite';
import type { LinhaEscala } from './montar-escalas.js';
import { ResolvedorItemLevel } from './item-level.js';
import { resolverArvoreDeBonus } from './resolucao-bonus.js';
import { calcularArmorModifier } from './montar-tabelas.js';
import { ResolvedorTrack } from './formula-track.js';
import { ResolvedorEfeito } from './formula-efeito.js';
import { carregarFixture, type EspecimeFixture } from './fixture.js';
import {
  carregarItemSparse,
  carregarMaterialPorItem,
  carregarArmorLocation,
  carregarStatsAdicionaisPorBonus,
  carregarQualidadeExtraPorBonus,
  carregarConjuntos,
  type ItemSparseResumo,
  type StatAdicional,
  type ConjuntoDeItens,
  type ArmorLocationLinha,
} from './carregadores.js';
import {
  resolverBudgetIndex,
  resolverTipoOrcamento,
  calcularValorStat,
  calcularArmadura,
  calcularBlock,
  calcularDanoDeArma,
  resolverTabelaDano,
  calcularValorEfeito,
} from '../../packages/shared/dist/index.mjs';

/**
 * O CORAÇÃO DA ISSUE (TIT-139): roda a fixture contra o dump a cada geração.
 * Se um espécime não fecha, o gerador se recusa a emitir o arquivo — sem
 * flag de pular. Ver "Como ele se confere" na issue.
 *
 * Escopo: item level, os valores de stat (primário, secundários,
 * terciários), armadura, `Block`, dano de arma, track, texto de efeito e o
 * conjunto.
 *
 * **Chave da fixture que ninguém confere é DIVERGÊNCIA, nunca `continue`**
 * (TIT-141). Foi um `continue` silencioso em cima de `typeof !== 'number'`
 * que deixou o `set` de três espécimes atravessar a fixture inteira sem
 * nunca ser olhado.
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
  const materialPorItem = carregarMaterialPorItem(db, itemIds);
  const armorLocationPorSlot = carregarArmorLocation(db);
  const statsExtrasPorBonus = carregarStatsAdicionaisPorBonus(db);
  const qualidadeExtraPorBonus = carregarQualidadeExtraPorBonus(db);
  const trackResolver = new ResolvedorTrack(db);
  const efeitoResolver = new ResolvedorEfeito(db);

  const itemSetIds = [
    ...new Set(
      [...itemSparsePorId.values()].map((i) => i.itemSet).filter((id): id is number => id !== 0),
    ),
  ];
  const conjuntosPorId = new Map(carregarConjuntos(db, itemSetIds).map((c) => [c.itemSetId, c]));

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

    const qualidade = resolverQualidade(
      bonusAplicados,
      qualidadeExtraPorBonus,
      item.overallQualityId,
    );
    const material = materialPorItem.get(especime.itemId) ?? 0;
    valoresConferidos += conferirArmaduraEBlock(
      divergencias,
      especime,
      material,
      item.inventoryType,
      qualidade,
      escala,
      armorLocationPorSlot,
    );
    valoresConferidos += conferirDanoDeArma(divergencias, especime, item, qualidade, escala);
    valoresConferidos += conferirTrack(divergencias, especime, bonusAplicados, trackResolver);
    valoresConferidos += conferirEfeito(divergencias, especime, escala, efeitoResolver);
    valoresConferidos += conferirSet(divergencias, especime, item.itemSet, conjuntosPorId);
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

/** Tolerância pequena para os dois únicos campos float exibidos direto do
 * tooltip (velocidade de arma, dps) — o resto da fórmula é inteiro. */
function conferirFloat(
  divergencias: DivergenciaFixture[],
  especime: string,
  campo: string,
  esperado: number,
  calculado: number,
): void {
  if (Math.abs(esperado - calculado) > 0.05) {
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

/** `Type 3` (`QUALITY`) sobrescreve a qualidade base do item — primeiro achado no union vale. */
function resolverQualidade(
  bonusAplicados: number[],
  qualidadeExtraPorBonus: Map<number, number>,
  base: number,
): number {
  for (const bonusId of bonusAplicados) {
    const override = qualidadeExtraPorBonus.get(bonusId);
    if (override !== undefined) return override;
  }
  return base;
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

  // Chaves conferidas por helpers dedicados, fora desta função — armadura,
  // dano e block não são "stat" no sentido do `ItemSparse`.
  const CONFERIDO_EM_OUTRO_LUGAR = new Set([
    'armadura',
    'danoMin',
    'danoMax',
    'dps',
    'block',
    'track',
    // Os dois abaixo têm conferidor próprio — `conferirEfeito` e `conferirSet`.
    'efeito',
    'set',
  ]);
  const ehArma = 'danoMin' in esperado;

  for (const [campo, valorEsperado] of Object.entries(esperado)) {
    if (CONFERIDO_EM_OUTRO_LUGAR.has(campo)) continue;
    if (campo === 'speed' && ehArma) continue; // "speed" de arma é velocidade, conferido em conferirDanoDeArma.

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

    // `Indestructible` é FLAG: a fórmula calcula um número (68 no espécime) e
    // o jogo mostra só a palavra. Conferir o valor seria conferir algo que a
    // tela nunca imprime — o que se prova é que o terciário está PRESENTE.
    if (campo === 'indestructible') {
      conferir(
        divergencias,
        especime.nome,
        'indestructible',
        valorEsperado,
        computado.porNome.has('indestructible'),
      );
      conferidos++;
      continue;
    }

    // CHAVE QUE NINGUÉM CONFERE É DIVERGÊNCIA, NUNCA `continue` — TIT-141.
    //
    // A versão anterior fazia `if (typeof valorEsperado !== 'number') continue`,
    // e foi assim que o `set` dos três espécimes atravessou a fixture inteira
    // sem NUNCA ser verificado: ele é objeto, então o laço o pulava calado.
    // Auto-conferência que ignora o que não entende dá falsa segurança — o
    // "199/199" contava só o que ela topava conferir.
    if (typeof valorEsperado !== 'number') {
      divergencias.push({
        especime: especime.nome,
        campo,
        esperado: valorEsperado,
        calculado:
          '(nenhum conferidor cobre esta chave — acrescente um, ou liste em CONFERIDO_EM_OUTRO_LUGAR)',
      });
      continue;
    }

    conferir(divergencias, especime.nome, campo, valorEsperado, computado.porNome.get(campo));
    conferidos++;
  }

  return conferidos;
}

function conferirArmaduraEBlock(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  material: number,
  inventoryType: number,
  qualidade: number,
  escala: LinhaEscala,
  armorLocationPorSlot: Map<number, ArmorLocationLinha>,
): number {
  let conferidos = 0;
  const { esperado } = especime;

  if (typeof esperado.armadura === 'number') {
    // O MESMO modificador que vai pro `WowItemData.armorModifier` — não a
    // tabela inteira. `calcularArmadura` (shared) recebe o escalar já
    // resolvido, igual ao resolvedor de runtime; duas contas separadas
    // divergiriam em silêncio no dia em que uma mudasse sem a outra.
    const armorModifier = calcularArmorModifier(material, inventoryType, armorLocationPorSlot);
    const armadura = calcularArmadura(material, inventoryType, qualidade, escala, armorModifier);
    conferir(divergencias, especime.nome, 'armadura', esperado.armadura, armadura ?? 0);
    conferidos++;
  }

  if (typeof esperado.block === 'number') {
    conferir(
      divergencias,
      especime.nome,
      'block',
      esperado.block,
      calcularBlock(qualidade, escala),
    );
    conferidos++;
  }

  return conferidos;
}

function conferirDanoDeArma(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  item: ItemSparseResumo,
  qualidade: number,
  escala: LinhaEscala,
): number {
  const { esperado } = especime;
  if (typeof esperado.danoMin !== 'number') return 0;

  const tabela = resolverTabelaDano(item.inventoryType, item.flags);
  if (!tabela) {
    divergencias.push({
      especime: especime.nome,
      campo: 'tabelaDano',
      esperado: 'uma tabela',
      calculado: 'nenhuma (InventoryType não é arma)',
    });
    return 0;
  }

  const dano = calcularDanoDeArma(tabela, qualidade, item.itemDelay, item.dmgVariance, escala);
  conferir(divergencias, especime.nome, 'danoMin', esperado.danoMin, dano.min);
  conferir(divergencias, especime.nome, 'danoMax', esperado.danoMax as number, dano.max);
  if (typeof esperado.dps === 'number')
    conferirFloat(divergencias, especime.nome, 'dps', esperado.dps, dano.dps);
  if (typeof esperado.speed === 'number')
    conferirFloat(divergencias, especime.nome, 'speed', esperado.speed, item.itemDelay / 1000);

  return 4;
}

/**
 * Só confere quando a fixture registra `track` — o gerador não decide se a
 * linha aparece (depende da season corrente, ver `WowBonus.trackScalingId`),
 * então um bônus de track sem linha esperada no tooltip (season passada,
 * ex. Platinum Star Band) simplesmente não entra na comparação.
 */
function conferirTrack(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  bonusAplicados: number[],
  resolver: ResolvedorTrack,
): number {
  if (!especime.track) return 0;

  const track = bonusAplicados.map((b) => resolver.resolver(b)).find((t) => t !== null) ?? null;
  if (!track) {
    divergencias.push({
      especime: especime.nome,
      campo: 'track',
      esperado: especime.track,
      calculado: null,
    });
    return 1;
  }

  conferir(divergencias, especime.nome, 'track.nome', especime.track.nome, track.nome);
  conferir(divergencias, especime.nome, 'track.rank', especime.track.rank, track.rank);
  conferir(divergencias, especime.nome, 'track.total', especime.track.total, track.total);
  return 3;
}

/**
 * `esperado.efeito` traz chaves `sN_rotulo` (ex. `s1_strength`) para os
 * placeholders numéricos, mais `duracaoSegundos`/`maxStacks`.
 * `cooldownMinutos` e `textoRenderizado` ficam de fora — ver a lacuna
 * documentada no topo de `formula-efeito.ts` (cooldown de proc não sai de
 * nenhuma tabela extraída).
 */
function conferirEfeito(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  escala: LinhaEscala,
  resolver: ResolvedorEfeito,
): number {
  const efeitoEsperado = especime.esperado.efeito as Record<string, unknown> | undefined;
  if (!efeitoEsperado) return 0;

  const efeito = resolver.resolverPorItem(especime.itemId);
  if (!efeito) {
    divergencias.push({
      especime: especime.nome,
      campo: 'efeito',
      esperado: 'presente',
      calculado: 'ausente',
    });
    return 1;
  }

  let conferidos = 0;
  for (const [campo, valorEsperado] of Object.entries(efeitoEsperado)) {
    if (campo === 'cooldownMinutos' || campo === 'textoRenderizado') continue;
    if (typeof valorEsperado !== 'number') continue;

    if (campo === 'duracaoSegundos') {
      conferir(
        divergencias,
        especime.nome,
        campo,
        valorEsperado,
        efeito.duracaoMs === null ? null : efeito.duracaoMs / 1000,
      );
      conferidos++;
      continue;
    }
    if (campo === 'maxStacks') {
      conferir(divergencias, especime.nome, campo, valorEsperado, efeito.maxStacks);
      conferidos++;
      continue;
    }

    const match = /^s(\d+)_/.exec(campo);
    if (!match) continue;
    const effectIndex = Number(match[1]) - 1;
    const spellEfeito = efeito.efeitos.find((e) => e.effectIndex === effectIndex);
    const calculado = spellEfeito
      ? calcularValorEfeito(spellEfeito.coefficient, spellEfeito.scalingClass, escala)
      : undefined;
    conferir(divergencias, especime.nome, campo, valorEsperado, calculado);
    conferidos++;
  }

  return conferidos;
}

/**
 * O conjunto: nome e número de peças — TIT-141.
 *
 * **Antes desta função a chave `set` da fixture atravessava a conferência sem
 * ser olhada**, porque o laço de stats pulava tudo que não fosse número. Três
 * espécimes trazem set e nenhum era verificado por caminho nenhum.
 *
 * O TEXTO dos bônus não é conferido aqui: ele depende de renderizar spell com
 * placeholder e de saber a spec, o que é da TIT-136. O que se prova agora é
 * que o conjunto existe, tem o nome certo e o número certo de peças — e isso
 * já pega o erro que importa: item apontando para conjunto errado.
 */
function conferirSet(
  divergencias: DivergenciaFixture[],
  especime: EspecimeFixture,
  itemSet: number,
  conjuntosPorId: Map<number, ConjuntoDeItens>,
): number {
  // NO TOPO do espécime, não em `esperado` — ver o comentário do campo em
  // `fixture.ts`. Lia do lugar errado e devolvia zero calado.
  const esperado = especime.set;
  if (!esperado) return 0;

  const conjunto = conjuntosPorId.get(itemSet);
  if (!conjunto) {
    divergencias.push({
      especime: especime.nome,
      campo: 'set',
      esperado: esperado.nome ?? '(conjunto)',
      calculado: `ItemSparse.ItemSet = ${itemSet}, sem linha em ItemSet`,
    });
    return 0;
  }

  let conferidos = 0;
  if (esperado.itemSetId !== undefined) {
    conferir(divergencias, especime.nome, 'set.itemSetId', esperado.itemSetId, conjunto.itemSetId);
    conferidos++;
  }
  if (esperado.nome !== undefined) {
    conferir(divergencias, especime.nome, 'set.nome', esperado.nome, conjunto.name);
    conferidos++;
  }
  if (esperado.pecas !== undefined) {
    conferir(
      divergencias,
      especime.nome,
      'set.pecas',
      esperado.pecas,
      conjunto.pieceItemIds.length,
    );
    conferidos++;
  }
  return conferidos;
}
