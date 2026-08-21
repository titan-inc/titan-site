import type { BonusFacets } from '@titan/shared';
import type { WowDataRepository } from './wow-data.repository';
import { WowDataService } from './wow-data.service';

function facetas(over: Partial<BonusFacets> & { bonusId: number }): BonusFacets {
  return {
    trackName: null,
    trackRank: null,
    trackMaxRank: null,
    trackScalingId: null,
    itemLevel: null,
    tertiary: null,
    hasSocket: false,
    binding: null,
    difficulty: null,
    difficultyColor: null,
    quality: null,
    ...over,
  };
}

describe('WowDataService.decodificar', () => {
  const repo = {
    buildAtivo: jest.fn<Promise<string | null>, []>(() => Promise.resolve('12.1.0.69299')),
    facetasDeBonus: jest.fn<Promise<BonusFacets[]>, [string, number[]]>(() => Promise.resolve([])),
  };

  const service = new WowDataService(repo as unknown as WowDataRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    repo.buildAtivo.mockResolvedValue('12.1.0.69299');
  });

  it('busca só os ids pedidos, no build ativo, e decodifica', async () => {
    repo.facetasDeBonus.mockResolvedValueOnce([
      facetas({ bonusId: 12806, trackName: 'Myth', trackRank: 4, trackMaxRank: 6 }),
      facetas({ bonusId: 40, tertiary: 'avoidance' }),
    ]);

    const resultado = await service.decodificar([12806, 40]);

    expect(repo.facetasDeBonus).toHaveBeenCalledWith('12.1.0.69299', [12806, 40]);
    expect(resultado.track).toEqual({ nome: 'Myth', rank: 4, de: 6, scalingId: null });
    expect(resultado.terciarios).toEqual(['avoidance']);
  });

  it('lista vazia não consulta o banco', async () => {
    const resultado = await service.decodificar([]);

    expect(repo.buildAtivo).not.toHaveBeenCalled();
    expect(repo.facetasDeBonus).not.toHaveBeenCalled();
    expect(resultado.desconhecidos).toEqual([]);
  });

  /**
   * O estado em que o banco NASCE, antes da primeira ativação (TIT-140).
   *
   * Não é erro e não pode derrubar tela: a resposta honesta é "não sei nada
   * sobre nenhum destes bonus". A tela mostra a lacuna, e ninguém vê número
   * inventado — Regra 7.
   */
  it('sem build ativo, todo bonus vira desconhecido em vez de estourar', async () => {
    repo.buildAtivo.mockResolvedValueOnce(null);

    const resultado = await service.decodificar([12806, 40]);

    expect(repo.facetasDeBonus).not.toHaveBeenCalled();
    expect(resultado.desconhecidos).toEqual([12806, 40]);
    expect(resultado.track).toBeNull();
    expect(resultado.itemLevel).toBeNull();
  });

  /**
   * O build é resolvido UMA VEZ e passado adiante. Se cada consulta
   * reconsultasse, uma ativação no meio da requisição faria a primeira ler um
   * build e a segunda ler outro — misturando dado em silêncio.
   */
  it('resolve o build ativo uma única vez por chamada', async () => {
    await service.decodificar([1, 2, 3]);

    expect(repo.buildAtivo).toHaveBeenCalledTimes(1);
  });
});
