import { Injectable } from '@nestjs/common';
import type { DecodedBonuses } from '@titan/shared';
import { decodeBonuses } from './wow-data-decoder';
import { WowDataRepository } from './wow-data.repository';

const saidaVazia: DecodedBonuses = {
  itemLevel: null,
  track: null,
  sockets: 0,
  terciarios: [],
  statsAdicionados: [],
  binding: null,
  dificuldade: null,
  qualidade: null,
  desconhecidos: [],
};

@Injectable()
export class WowDataService {
  constructor(private readonly repo: WowDataRepository) {}

  /**
   * `bonusIds` → estrutura legível.
   *
   * Resolve o build ativo **uma vez** e passa adiante — nunca deixa cada
   * consulta reconsultar, porque uma ativação no meio da requisição faria a
   * primeira ler um build e a segunda ler outro, sem erro nenhum.
   *
   * Busca só as facetas destes ids, nunca a tabela inteira: a sessão chama isto
   * por item, e a tabela cresce com o catálogo.
   */
  async decodificar(bonusIds: number[]): Promise<DecodedBonuses> {
    if (bonusIds.length === 0) return saidaVazia;

    const buildAtivo = await this.repo.buildAtivo();

    // SEM BUILD ATIVO A GENTE NÃO SABE NADA, e dizer isso é a resposta certa:
    // todo bonus vira desconhecido, a tela mostra a lacuna, e ninguém vê
    // número inventado. É o estado em que o banco nasce, antes da primeira
    // ativação (TIT-140) — não é erro, e não pode derrubar a tela.
    if (buildAtivo === null) {
      return { ...saidaVazia, desconhecidos: [...bonusIds] };
    }

    const facetas = await this.repo.facetasDeBonus(buildAtivo, bonusIds);
    const dicionario = new Map(facetas.map((f) => [f.bonusId, f]));

    return decodeBonuses(bonusIds, dicionario);
  }
}
