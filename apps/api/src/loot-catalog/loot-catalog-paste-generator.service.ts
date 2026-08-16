import { BadRequestException, Injectable } from '@nestjs/common';
import {
  RAID_DIFFICULTIES,
  SESSION_PASTE_VERSION,
  type EncounterDrop,
  type LootCatalogEncounter,
  type LootCatalogRaid,
  type RaidDifficultyLevel,
} from '@titan/shared';
import { amostraUm, embaralhar, sortearEntre } from '../common/random';
import { LootCatalogService } from './loot-catalog.service';

/** Menos que isso não parece um kill de verdade — ver TIT-68 (ferramenta de teste). */
const MIN_ITENS_POR_CANDIDATO = 3;
const MAX_ITENS_POR_COLAGEM = 6;

/** `difficultyID` do CLIENTE que o cabeçalho da colagem espera — ver `session-paste.ts`. */
const DIFICULDADE_PARA_CLIENTE: Readonly<Record<RaidDifficultyLevel, number>> = {
  [RAID_DIFFICULTIES.NORMAL]: 14,
  [RAID_DIFFICULTIES.HEROIC]: 15,
  [RAID_DIFFICULTIES.MYTHIC]: 16,
};

/** `itemContext` da PEÇA que `raidDifficultyFromItemString()` sabe ler — ver `item-string.ts`. */
const DIFICULDADE_PARA_CONTEXTO: Readonly<Record<RaidDifficultyLevel, number>> = {
  [RAID_DIFFICULTIES.NORMAL]: 3,
  [RAID_DIFFICULTIES.HEROIC]: 5,
  [RAID_DIFFICULTIES.MYTHIC]: 6,
};

/** Um boss, numa dificuldade, com itens suficientes para virar colagem de teste. */
interface Candidato {
  raid: LootCatalogRaid;
  encounter: LootCatalogEncounter;
  difficulty: RaidDifficultyLevel;
  drops: EncounterDrop[];
}

/**
 * Gera uma colagem de sessão de loot A PARTIR DO CATÁLOGO — TIT-68, ferramenta
 * de teste do realtime.
 *
 * Não inventa item: sorteia um boss/dificuldade REAL do catálogo com pelo
 * menos 3 drops cadastrados, e monta o texto exatamente no formato que
 * `parseSessionPaste()` espera. Quem chama cola o resultado direto no "Iniciar
 * sessão" que já existe — esta ferramenta não cria a sessão sozinha, só
 * poupa o trabalho de montar uma colagem válida à mão.
 */
@Injectable()
export class LootCatalogPasteGeneratorService {
  constructor(private readonly catalog: LootCatalogService) {}

  async gerarColagemAleatoria(): Promise<string> {
    const raids = await this.catalog.listRaids();
    const opcoes = candidatos(raids);

    if (opcoes.length === 0) {
      throw new BadRequestException(
        `Nenhum boss do catálogo tem pelo menos ${MIN_ITENS_POR_CANDIDATO} itens cadastrados ` +
          'numa dificuldade — gere/carregue o catálogo antes (ver docs/ops.md).',
      );
    }

    const escolhido = amostraUm(opcoes);
    const quantidade = Math.min(sortearEntre(3, MAX_ITENS_POR_COLAGEM), escolhido.drops.length);
    const itens = embaralhar(escolhido.drops).slice(0, quantidade);

    const linhas = [
      cabecalho(escolhido),
      ...itens.map((drop) => linhaDoItem(drop, escolhido.difficulty)),
    ];

    return linhas.join('\n');
  }
}

/** Todo (raid, boss, dificuldade) do catálogo com drop suficiente para uma colagem. */
function candidatos(raids: LootCatalogRaid[]): Candidato[] {
  const achados: Candidato[] = [];

  for (const raid of raids) {
    for (const encounter of raid.encounters) {
      // Sem id, a colagem gerada não casaria com o catálogo ao criar a sessão
      // — exatamente o caminho que esta ferramenta existe para exercitar.
      if (encounter.dungeonEncounterId === null) continue;

      for (const [difficulty, drops] of agruparPorDificuldade(encounter.drops)) {
        if (drops.length >= MIN_ITENS_POR_CANDIDATO) {
          achados.push({ raid, encounter, difficulty, drops });
        }
      }
    }
  }

  return achados;
}

function agruparPorDificuldade(drops: EncounterDrop[]): Map<RaidDifficultyLevel, EncounterDrop[]> {
  const porDificuldade = new Map<RaidDifficultyLevel, EncounterDrop[]>();

  for (const drop of drops) {
    const lista = porDificuldade.get(drop.difficulty) ?? [];
    lista.push(drop);
    porDificuldade.set(drop.difficulty, lista);
  }

  return porDificuldade;
}

function cabecalho(c: Candidato): string {
  return [
    SESSION_PASTE_VERSION,
    `encounter=${c.encounter.dungeonEncounterId}`,
    `encounterName=${c.encounter.name}`,
    `difficulty=${DIFICULDADE_PARA_CLIENTE[c.difficulty]}`,
    // Nulo vira campo vazio, que `inteiroOpcional()` já lê como "não sei" —
    // não é caso de erro, algumas raids do catálogo não têm o cadastro.
    `instance=${c.raid.instanceMapId ?? ''}`,
    `instanceName=${c.raid.name}`,
  ].join('\t');
}

/**
 * A linha de item da colagem. `linkLevel`/`spec` fixos e sem bônus: não
 * importam para o parser nem para a sessão — só `itemId` e `itemContext`
 * carregam significado aqui.
 *
 * Looter `?` (desconhecido) de propósito: inventar um nome pareceria dado
 * real, e o campo é só informativo — os dummies respondem por conta própria.
 */
function linhaDoItem(drop: EncounterDrop, difficulty: RaidDifficultyLevel): string {
  const itemString = `item:${drop.item.itemId}::::::::80:0::${DIFICULDADE_PARA_CONTEXTO[difficulty]}:0`;
  return [itemString, '?', 'auto'].join('\t');
}
