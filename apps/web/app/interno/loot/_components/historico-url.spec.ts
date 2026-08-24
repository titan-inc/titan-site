import { describe, expect, it } from 'vitest';
import { filtrosDaApi, seasonParaApi, TODAS_AS_SEASONS } from './historico-url';

describe('seasonParaApi', () => {
  it('repassa o id da season', () => {
    expect(seasonParaApi('17')).toBe('17');
  });

  it('"todas" vira ausência, que é como a API entende todas', () => {
    expect(seasonParaApi(TODAS_AS_SEASONS)).toBeUndefined();
  });

  it('ausência continua ausência — quem resolve o padrão é a página', () => {
    // Ausente na URL significa "primeira visita", e vira redirect para a season
    // mais recente. Se aqui virasse um id, o redirect nunca aconteceria.
    expect(seasonParaApi(undefined)).toBeUndefined();
  });
});

describe('filtrosDaApi', () => {
  it('monta a query com o que está preenchido', () => {
    const filtros = filtrosDaApi(
      { season: '17', character: 'Shrëwd-Area52', difficulty: 'mythic', page: '2' },
      '17',
    );

    expect(filtros).toEqual({
      season: '17',
      character: 'Shrëwd-Area52',
      difficulty: 'mythic',
      page: '2',
    });
  });

  it('NÃO deixa o token "todas" chegar na API', () => {
    // Este é o bug que o teste tranca: a season vem resolvida de fora, e ler
    // `busca.season` mandaria `season=todas` para o Nest, que responde 400 — e a
    // tela só dizia "não foi possível carregar", sem erro em lugar nenhum.
    const filtros = filtrosDaApi({ season: TODAS_AS_SEASONS, difficulty: 'heroic' }, undefined);

    expect(filtros).toEqual({ difficulty: 'heroic' });
    expect(filtros).not.toHaveProperty('season');
  });

  it('omite campo vazio em vez de mandar vazio', () => {
    // `?character=` é o que um `<select>` sem seleção manda, e a API recusa o
    // request inteiro por causa dele.
    const filtros = filtrosDaApi({ season: '17', character: '', slot: '' }, '17');

    expect(filtros).toEqual({ season: '17' });
  });

  it('sem filtro nenhum devolve query vazia', () => {
    expect(filtrosDaApi({}, undefined)).toEqual({});
  });

  it('não inventa chave que a tela não tem', () => {
    const filtros = filtrosDaApi({ season: '17' }, '17');

    expect(Object.keys(filtros)).toEqual(['season']);
  });
});
