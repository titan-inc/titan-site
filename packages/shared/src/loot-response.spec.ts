import { describe, expect, it } from 'vitest';
import {
  LOOT_RESPONSES,
  matchLegacyResponse,
  RESPOSTA_IGNORADA,
  lootResponseSlugSchema,
} from './loot-response.js';

/**
 * As combinações reais do export de 445 registros.
 *
 * Ficam aqui como fixture, e não lendo o arquivo: ele tem nome de personagem de
 * gente real e não pode ser versionado (ver "Segredos" no CLAUDE.md). Só rótulo e
 * id atravessam, que não identificam ninguém.
 */
const DO_EXPORT: Array<[responseId: string, rotulo: string, n: number]> = [
  ['1', 'BiS', 109],
  ['1', 'BIS', 15],
  ['2', 'Big', 64],
  ['2', 'BIG', 16],
  ['2', 'Banking', 2],
  ['3', 'Minor', 31],
  ['3', 'Minor Upgrade', 2],
  ['4', 'Offspec', 19],
  ['5', 'XMog', 35],
  ['PASS', 'Pass', 1],
  ['BONUSROLL', 'Bonus Loot', 86],
  ['BONUSROLL', 'Bonus de botín', 2],
  ['PL', 'Personal Loot - Non tradeable', 63],
];

/** Total do export. Amarra a fixture à realidade em vez de a ela mesma. */
const TOTAL_DO_EXPORT = 445;

describe('matchLegacyResponse', () => {
  it('classifica as 13 combinações do export, sem sobrar nenhuma', () => {
    const desconhecidas = DO_EXPORT.filter(
      ([id, rotulo]) => matchLegacyResponse(id, rotulo).kind === 'desconhecida',
    );

    expect(desconhecidas).toEqual([]);
  });

  it('a fixture cobre o export inteiro', () => {
    // Sem isto o teste abaixo compararia meus números com meus números. A
    // primeira versão errou justamente assim: usei a contagem só de raid (71
    // Bonus Loot) numa fixture que descreve os 445, e a soma fechou errada sem
    // nenhum teste reclamar.
    expect(DO_EXPORT.reduce((t, [, , n]) => t + n, 0)).toBe(TOTAL_DO_EXPORT);
  });

  it('separa o que passou pelo conselho do que foi distribuído automático', () => {
    const soma = (kinds: string[]) =>
      DO_EXPORT.filter(([id, r]) => kinds.includes(matchLegacyResponse(id, r).kind)).reduce(
        (t, [, , n]) => t + n,
        0,
      );

    expect(soma(['response'])).toBe(294);
    expect(soma([RESPOSTA_IGNORADA])).toBe(151);
    expect(soma(['response', RESPOSTA_IGNORADA])).toBe(TOTAL_DO_EXPORT);
  });

  describe('os dois campos juntos, nunca um sozinho', () => {
    it('o mesmo responseID 2 vira coisas opostas conforme o rótulo', () => {
      // A armadilha central: o id é o índice do botão na config daquele raid.
      expect(matchLegacyResponse('2', 'Big')).toEqual({
        kind: 'response',
        response: LOOT_RESPONSES.UPGRADE,
      });
      expect(matchLegacyResponse('2', 'Banking')).toEqual({
        kind: 'response',
        response: LOOT_RESPONSES.BANKING,
      });
    });

    it('o mesmo rótulo com id diferente não casa', () => {
      // Se casasse só por rótulo, uma reconfiguração dos botões passaria batida.
      expect(matchLegacyResponse('9', 'Big').kind).toBe('desconhecida');
    });
  });

  it('colapsa caixa, porque o rótulo vem do cliente de quem era loot master', () => {
    expect(matchLegacyResponse('1', 'BIS')).toEqual(matchLegacyResponse('1', 'bis'));
    expect(matchLegacyResponse('1', '  BiS  ')).toEqual(matchLegacyResponse('1', 'bis'));
    expect(matchLegacyResponse('bonusroll', 'bonus loot').kind).toBe(RESPOSTA_IGNORADA);
  });

  it('NÃO colapsa acento: rótulo é texto de outra ferramenta, não nome', () => {
    // Sem o acento certo o import para, e alguém decide. Melhor que adivinhar
    // que dois rótulos parecidos são o mesmo.
    expect(matchLegacyResponse('BONUSROLL', 'Bonus de botin').kind).toBe('desconhecida');
    expect(matchLegacyResponse('BONUSROLL', 'Bonus de botín').kind).toBe(RESPOSTA_IGNORADA);
  });

  it('devolve a chave na combinação desconhecida, para o erro dizer o que adicionar', () => {
    const r = matchLegacyResponse('7', 'Tmog Novo');

    expect(r).toEqual({ kind: 'desconhecida', chave: '7|tmog novo' });
  });

  it('descarte é valor explícito, distinto de desconhecido', () => {
    // Se os dois fossem a mesma coisa, "Bonus Loot" seria indistinguível de um
    // rótulo que ninguém mapeou — um é decisão, o outro é buraco.
    expect(matchLegacyResponse('PL', 'Personal Loot - Non tradeable').kind).toBe(RESPOSTA_IGNORADA);
    expect(matchLegacyResponse('PL', 'Qualquer Outra Coisa').kind).toBe('desconhecida');
  });
});

describe('LOOT_RESPONSES', () => {
  it('semeia dez slugs: seis de jogador, três de loot master e um de sistema', () => {
    expect(Object.values(LOOT_RESPONSES).sort()).toEqual([
      'banking',
      'bis',
      'disenchant',
      'minor',
      'no_interest',
      'noop',
      'offspec',
      'pass',
      'transmog',
      'upgrade',
    ]);
  });

  it('as razões de loot master não se confundem com o que o jogador declara', () => {
    // `no_interest` é o conselho diante de uma peça que ninguém quis. `pass` é a
    // pessoa abrindo mão, e `noop` é ela não ter dito nada. Três coisas.
    const doLootMaster = [
      LOOT_RESPONSES.BANKING,
      LOOT_RESPONSES.DISENCHANT,
      LOOT_RESPONSES.NO_INTEREST,
    ];

    expect(doLootMaster).not.toContain(LOOT_RESPONSES.PASS);
    expect(doLootMaster).not.toContain(LOOT_RESPONSES.NOOP);
  });

  it('`noop` e `pass` são slugs diferentes, e é o ponto', () => {
    // `pass` é declaração — a pessoa olhou a peça e abriu mão. `noop` é
    // silêncio de quem estava na sessão. Colapsar os dois faria o histórico
    // afirmar uma escolha que ninguém fez.
    expect(LOOT_RESPONSES.NOOP).not.toBe(LOOT_RESPONSES.PASS);
  });

  it('o slug de resposta NÃO é enum fechado', () => {
    // A lista de opções é tabela configurável: um `nativeEnum` aqui recusaria a
    // opção que a liderança cadastrar na tela. Quem valida é a linha da tabela.
    expect(lootResponseSlugSchema.safeParse('uma-opcao-que-a-lideranca-criou').success).toBe(true);
    expect(lootResponseSlugSchema.safeParse('').success).toBe(false);
  });

  it('todo destino do tradutor é um slug semeado', () => {
    // Se o tradutor apontasse para um slug que a migration não semeia, o import
    // quebraria na FK — e só na hora de importar, longe daqui.
    const semeados = new Set<string>(Object.values(LOOT_RESPONSES));
    const destinos = DO_EXPORT.map(([id, rotulo]) => matchLegacyResponse(id, rotulo))
      .filter((m): m is Extract<typeof m, { kind: 'response' }> => m.kind === 'response')
      .map((m) => m.response);

    expect(destinos.length).toBeGreaterThan(0);
    expect(destinos.filter((d) => !semeados.has(d))).toEqual([]);
  });

  it('o valor é o rótulo, nunca a posição', () => {
    // Um enum numérico aqui reintroduziria em casa o problema do `responseID`.
    for (const v of Object.values(LOOT_RESPONSES)) {
      expect(Number.isNaN(Number(v))).toBe(true);
    }
  });
});
