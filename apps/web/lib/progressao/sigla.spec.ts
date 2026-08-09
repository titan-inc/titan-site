import { describe, expect, it } from 'vitest';
import { siglaDificuldade, siglaRaid } from './sigla';

describe('sigla de raid', () => {
  it('usa as iniciais das palavras significativas', () => {
    expect(siglaRaid('Complexo Meridian')).toBe('CM');
    expect(siglaRaid('Palácio de Nerub-ar')).toBe('PNA');
  });

  it('ignora artigos e preposições', () => {
    expect(siglaRaid('Libertação de Undermine')).toBe('LU');
    expect(siglaRaid('The Tomb of Sargeras')).toBe('TS');
  });

  // Uma letra sozinha não identifica raid nenhuma.
  it('usa três letras quando o nome é uma palavra só', () => {
    expect(siglaRaid('Ulduar')).toBe('ULD');
  });

  // Acima de quatro caracteres volta a não caber, que é o problema original.
  it('nunca passa de quatro caracteres', () => {
    expect(siglaRaid('Um Nome Muito Longo De Raid Enorme').length).toBeLessThanOrEqual(4);
  });

  it('preserva acento na inicial', () => expect(siglaRaid('Última Fortaleza')).toBe('ÚF'));

  it('devolve string vazia para nome vazio', () => {
    expect(siglaRaid('')).toBe('');
    expect(siglaRaid('   ')).toBe('');
  });

  it('não quebra com pontuação solta', () => expect(siglaRaid('!!! ???')).toHaveLength(3));
});

describe('sigla de dificuldade', () => {
  it('reconhece as formas em inglês', () => {
    expect(siglaDificuldade('Mythic')).toBe('M');
    expect(siglaDificuldade('Heroic')).toBe('H');
    expect(siglaDificuldade('Normal')).toBe('N');
    expect(siglaDificuldade('Raid Finder')).toBe('LFR');
  });

  // `resumirProgressaoNav` traduz Mythic para Mítico em dado de desenvolvimento.
  it('reconhece as formas em português', () => {
    expect(siglaDificuldade('Mítico')).toBe('M');
    expect(siglaDificuldade('Heroico')).toBe('H');
  });

  it('cai na inicial quando não reconhece', () =>
    expect(siglaDificuldade('Experimental')).toBe('E'));

  it('devolve string vazia para nome vazio', () => expect(siglaDificuldade('  ')).toBe(''));
});
