import type { WowDataFile } from '@titan/shared';
import { WowDataLoaderService } from './wow-data-loader.service';
import type { ContagemDeLinhasGravadas, WowDataRepository } from './wow-data.repository';

function arquivoMinimo(build: string): WowDataFile {
  return {
    version: 1,
    build,
    itens: { cols: [], rows: [] },
    bonuses: { cols: [], rows: [] },
    contextos: { cols: [], rows: [] },
    escalas: { cols: [], rows: [] },
    sets: { cols: [], rows: [] },
  } as unknown as WowDataFile;
}

function montar(dados: { buildAtivo?: string | null; buildExiste?: boolean } = {}) {
  const contagem: ContagemDeLinhasGravadas = {
    novo: true,
    itens: 963,
    bonuses: 10085,
    contextos: 163207,
    escalas: 1300,
    sets: 0,
  };

  const repo = {
    regravarBuild: jest.fn(() => Promise.resolve(contagem)),
    buildAtivo: jest.fn(() => Promise.resolve(dados.buildAtivo ?? null)),
    buildExiste: jest.fn(() => Promise.resolve(dados.buildExiste ?? true)),
    ativarBuild: jest.fn(() => Promise.resolve()),
  };

  const service = new WowDataLoaderService(repo as unknown as WowDataRepository);
  return { service, repo, contagem };
}

describe('WowDataLoaderService.carregar', () => {
  it('nunca ativa — só grava e devolve as contagens', async () => {
    const { service, repo } = montar({ buildAtivo: null });

    const resultado = await service.carregar(arquivoMinimo('12.1.0.69299'));

    expect(repo.ativarBuild).not.toHaveBeenCalled();
    expect(resultado.linhas).toEqual({
      itens: 963,
      bonuses: 10085,
      contextos: 163207,
      escalas: 1300,
      sets: 0,
    });
  });

  it('build carregado que NÃO é o ativo: `ativo` false, sem aviso', async () => {
    const { service } = montar({ buildAtivo: '11.0.0.1' });

    const resultado = await service.carregar(arquivoMinimo('12.1.0.69299'));

    expect(resultado.ativo).toBe(false);
    expect(resultado.aviso).toBeUndefined();
  });

  /**
   * O caso que a TIT-140 pede pra "gritar": recarregar o build que a guilda
   * está vendo agora. A resposta tem que carregar um aviso que ninguém
   * consegue não ver — não um campo genérico de log.
   */
  it('recarregar o build ATIVO: `ativo` true, e o aviso menciona o build', async () => {
    const { service } = montar({ buildAtivo: '12.1.0.69299' });

    const resultado = await service.carregar(arquivoMinimo('12.1.0.69299'));

    expect(resultado.ativo).toBe(true);
    expect(resultado.aviso).toBeDefined();
    expect(resultado.aviso).toContain('12.1.0.69299');
    expect(resultado.aviso).toContain('ATIVO');
  });

  it('repassa build e tabelas convertidas pro repository', async () => {
    const { service, repo } = montar();

    await service.carregar(arquivoMinimo('12.1.0.69299'));

    expect(repo.regravarBuild).toHaveBeenCalledWith(
      '12.1.0.69299',
      expect.objectContaining({ itens: [], bonuses: [], contextos: [], escalas: [], sets: [] }),
    );
  });
});

describe('WowDataLoaderService.ativar', () => {
  it('recusa ativar build que nunca foi carregado', async () => {
    const { service, repo } = montar({ buildExiste: false });

    await expect(service.ativar('12.9.9.99999')).rejects.toThrow(/nunca foi carregado/);
    expect(repo.ativarBuild).not.toHaveBeenCalled();
  });

  it('ativa e devolve o build anterior', async () => {
    const { service, repo } = montar({ buildExiste: true, buildAtivo: '11.0.0.1' });

    const resultado = await service.ativar('12.1.0.69299');

    expect(repo.ativarBuild).toHaveBeenCalledWith('12.1.0.69299');
    expect(resultado).toEqual({ build: '12.1.0.69299', anterior: '11.0.0.1' });
  });

  it('sem build ativo antes, `anterior` é null — é a primeira ativação', async () => {
    const { service } = montar({ buildExiste: true, buildAtivo: null });

    const resultado = await service.ativar('12.1.0.69299');

    expect(resultado.anterior).toBeNull();
  });
});
