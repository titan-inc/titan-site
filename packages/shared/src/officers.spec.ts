import { describe, expect, it } from 'vitest';
import { isOfficerByGrants, isOfficerByRank } from './officers.js';

/**
 * Ids fictícios de propósito — CLAUDE.md proíbe nome real de membro no repo.
 *
 * Depois da TIT-132 a comparação é interseção direta de `characterId`: quem
 * resolve nome+realm (acento, capitalização, separador de realm) para
 * identidade é o `CharactersRepository`, antes de chegar aqui. Os casos de
 * normalização de grafia têm o teste deles lá, e no `wow.spec.ts` das funções
 * de chave — não neste arquivo, que não vê nome nenhum.
 */
describe('isOfficerByGrants', () => {
  it('reconhece a conta quando um personagem dela tem grant', () => {
    expect(isOfficerByGrants(['char-fulano'], ['char-fulano'])).toBe(true);
  });

  it('nega quando nenhum personagem casa', () => {
    expect(isOfficerByGrants(['char-fulano'], ['char-sicrano'])).toBe(false);
  });

  it('basta UM personagem com grant, não todos', () => {
    // Agregação por pessoa da Regra 4: a conta é a pessoa, não o personagem.
    const conta = ['char-altzinho', 'char-mainzao', 'char-bankalt'];
    expect(isOfficerByGrants(conta, ['char-mainzao'])).toBe(true);
  });

  it('é falso quando não há grant nenhum', () => {
    // O estado inicial do sistema. Sem isto, um banco vazio poderia virar
    // "todo mundo é oficial" numa refatoração de `every`/`some`.
    expect(isOfficerByGrants(['char-fulano'], [])).toBe(false);
  });

  it('é falso para conta sem personagem no roster', () => {
    expect(isOfficerByGrants([], ['char-fulano'])).toBe(false);
  });
});

/** O corte real da guilda hoje: rank 2 é o mais baixo dos ranks de oficial. */
const CORTE = 2;

describe('isOfficerByRank', () => {
  it('promove quem está nos ranks de oficial', () => {
    expect(isOfficerByRank(0, CORTE)).toBe(true);
    expect(isOfficerByRank(1, CORTE)).toBe(true);
    expect(isOfficerByRank(2, CORTE)).toBe(true);
  });

  it('não promove quem está abaixo do corte', () => {
    // Rank 3 e 4 entram na área interna e continuam sem ver histórico dos
    // outros — dois gates independentes, Regra 4.
    expect(isOfficerByRank(3, CORTE)).toBe(false);
    expect(isOfficerByRank(4, CORTE)).toBe(false);
    expect(isOfficerByRank(7, CORTE)).toBe(false);
  });

  it('rank 0 é o mais alto, não o mais baixo', () => {
    // Inverter a comparação daria acesso aos ~590 e tiraria da liderança.
    expect(isOfficerByRank(0, CORTE)).toBe(true);
    expect(isOfficerByRank(7, CORTE)).toBe(false);
  });

  it('aceita corte 0 — só o guild master', () => {
    expect(isOfficerByRank(0, 0)).toBe(true);
    expect(isOfficerByRank(1, 0)).toBe(false);
  });

  it('é falso para conta sem personagem no roster', () => {
    // Rank nulo é estado inconsistente ou não-membro. Diante de dúvida, negar:
    // liberar por engano expõe Discord tag e texto de candidatura.
    expect(isOfficerByRank(null, CORTE)).toBe(false);
  });
});
