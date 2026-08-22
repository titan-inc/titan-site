import { Injectable, NotFoundException } from '@nestjs/common';
import {
  COLS_BONUS,
  COLS_CONTEXT,
  COLS_ITEM,
  COLS_SCALING,
  linhasParaObjetos,
  type WowDataFile,
} from '@titan/shared';
import { WowDataRepository } from './wow-data.repository';

/** O que a carga fez, para o `curl` conseguir mostrar. */
export interface WowDataLoadResult {
  build: string;
  /** `false` quando o build já existia — é o caso de recarregar. */
  novo: boolean;
  /** Este build é o que a guilda enxerga AGORA — carregar nunca muda isto. */
  ativo: boolean;
  linhas: { itens: number; bonuses: number; contextos: number; escalas: number };
  /**
   * Só existe quando `ativo` é `true`. Não é aviso genérico — é a frase que
   * torna impossível carregar por engano o build ativo sem perceber, porque
   * a carga acabou de regravar o que a guilda está vendo agora mesmo.
   */
  aviso?: string;
}

export interface WowDataActivateResult {
  build: string;
  /** O build que estava ativo antes desta chamada, ou `null` se nenhum. */
  anterior: string | null;
}

/**
 * Carrega e ativa builds do dado do cliente do WoW — TIT-140.
 *
 * Duas ações, dois riscos: carregar é inofensivo (só grava, ninguém vê
 * diferença), ativar é o que a guilda enxerga. Por isso vivem em métodos
 * separados, chamados por rotas separadas — nunca um flag escondido dentro da
 * carga.
 */
@Injectable()
export class WowDataLoaderService {
  constructor(private readonly repo: WowDataRepository) {}

  /**
   * Grava um build inteiro. **NUNCA ativa** — é o `WowDataRepository` quem
   * garante isso (`regravarBuild` não toca `active`), aqui só se orquestra a
   * conversão colunar → objeto e se monta a resposta.
   */
  async carregar(arquivo: WowDataFile): Promise<WowDataLoadResult> {
    const contagem = await this.repo.regravarBuild(arquivo.build, {
      itens: linhasParaObjetos(COLS_ITEM, arquivo.itens),
      bonuses: linhasParaObjetos(COLS_BONUS, arquivo.bonuses),
      contextos: linhasParaObjetos(COLS_CONTEXT, arquivo.contextos),
      escalas: linhasParaObjetos(COLS_SCALING, arquivo.escalas),
    });

    const buildAtivo = await this.repo.buildAtivo();
    const ativo = buildAtivo === arquivo.build;

    return {
      build: arquivo.build,
      novo: contagem.novo,
      ativo,
      linhas: {
        itens: contagem.itens,
        bonuses: contagem.bonuses,
        contextos: contagem.contextos,
        escalas: contagem.escalas,
      },
      aviso: ativo ? avisoDeRecargaDoAtivo(arquivo.build) : undefined,
    };
  }

  /**
   * Troca qual build a guilda enxerga. Recusa build que nunca foi carregado —
   * sem isto, o `UPDATE` de `ativarBuild` casaria zero linhas em silêncio, e
   * quem chamou acharia que ativou.
   */
  async ativar(buildId: string): Promise<WowDataActivateResult> {
    if (!(await this.repo.buildExiste(buildId))) {
      throw new NotFoundException(
        `Build ${buildId} nunca foi carregado — use wow-data-load antes de ativar.`,
      );
    }

    const anterior = await this.repo.buildAtivo();
    await this.repo.ativarBuild(buildId);

    return { build: buildId, anterior };
  }
}

function avisoDeRecargaDoAtivo(build: string): string {
  return (
    `ESTE BUILD (${build}) ESTÁ ATIVO AGORA — a guilda já está vendo, neste ` +
    'exato momento, os dados que esta chamada acabou de regravar.'
  );
}
