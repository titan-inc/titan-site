import { describe, expect, it } from 'vitest';
import {
  criarVagaSchema,
  descreverFaixaDeKey,
  descreverVagas,
  VAGA_AGENDAMENTO_MAX_DIAS,
  VAGA_EXPURGO_DIAS,
} from './mplus.js';

const DIA_MS = 24 * 60 * 60 * 1_000;
const emDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString();

const vagaValida = {
  vagas: { tank: 0, healer: 1, dps: 1 },
  quando: emDias(1),
  keyMin: 12,
  keyMax: 14,
  faltando: ['lust' as const],
  observacao: 'Fecha o dever de casa da semana.',
};

describe('criarVagaSchema', () => {
  it('aceita uma vaga completa', () => {
    expect(criarVagaSchema.safeParse(vagaValida).success).toBe(true);
  });

  it('aceita sem observação e sem buff faltando', () => {
    const { observacao: _observacao, ...semObservacao } = vagaValida;
    expect(criarVagaSchema.safeParse({ ...semObservacao, faltando: [] }).success).toBe(true);
  });

  it('exige pelo menos uma vaga', () => {
    const resultado = criarVagaSchema.safeParse({
      ...vagaValida,
      vagas: { tank: 0, healer: 0, dps: 0 },
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['vagas']);
  });

  it('não deixa o grupo passar de 5', () => {
    expect(
      criarVagaSchema.safeParse({ ...vagaValida, vagas: { tank: 1, healer: 1, dps: 4 } }).success,
    ).toBe(false);
    expect(
      criarVagaSchema.safeParse({ ...vagaValida, vagas: { tank: 2, healer: 1, dps: 1 } }).success,
    ).toBe(false);
  });

  it('exige keyMax >= keyMin', () => {
    const resultado = criarVagaSchema.safeParse({ ...vagaValida, keyMin: 15, keyMax: 12 });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['keyMax']);
  });

  it('aceita faixa de key de um número só', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 12, keyMax: 12 }).success).toBe(true);
  });

  it('aceita M0, que na pré-season é a única coisa que existe', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 0, keyMax: 0 }).success).toBe(true);
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 0, keyMax: 2 }).success).toBe(true);
  });

  it('recusa key +1, que não existe no jogo', () => {
    // Os níveis são 0, 2, 3, 4... — de M0 o próximo é +2.
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 1, keyMax: 4 }).success).toBe(false);
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 0, keyMax: 1 }).success).toBe(false);
  });

  it('recusa nível negativo e acima do teto', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: -1, keyMax: 4 }).success).toBe(false);
    expect(criarVagaSchema.safeParse({ ...vagaValida, keyMin: 2, keyMax: 41 }).success).toBe(false);
  });

  it('recusa horário no passado', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, quando: emDias(-1) }).success).toBe(false);
  });

  it('recusa agendamento além da janela do expurgo', () => {
    // A janela de agendamento tem que caber dentro da de expurgo, senão a vaga
    // some do site antes da noite acontecer.
    expect(VAGA_AGENDAMENTO_MAX_DIAS).toBeLessThan(VAGA_EXPURGO_DIAS);

    expect(
      criarVagaSchema.safeParse({ ...vagaValida, quando: emDias(VAGA_AGENDAMENTO_MAX_DIAS - 0.5) })
        .success,
    ).toBe(true);
    expect(
      criarVagaSchema.safeParse({ ...vagaValida, quando: emDias(VAGA_EXPURGO_DIAS + 1) }).success,
    ).toBe(false);
  });

  it('exige data em formato ISO com fuso', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, quando: 'amanhã 21h' }).success).toBe(false);
    expect(criarVagaSchema.safeParse({ ...vagaValida, quando: '2026-08-13 21:00' }).success).toBe(
      false,
    );
  });

  it('limita a observação em 500 caracteres', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, observacao: 'a'.repeat(500) }).success).toBe(
      true,
    );
    expect(criarVagaSchema.safeParse({ ...vagaValida, observacao: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('recusa buff desconhecido e buff repetido', () => {
    expect(criarVagaSchema.safeParse({ ...vagaValida, faltando: ['bloodlust'] }).success).toBe(
      false,
    );
    expect(criarVagaSchema.safeParse({ ...vagaValida, faltando: ['lust', 'lust'] }).success).toBe(
      false,
    );
  });
});

describe('descreverVagas', () => {
  it('lista só o que falta, na ordem do grupo', () => {
    expect(descreverVagas({ tank: 0, healer: 1, dps: 1 })).toBe('healer + dps');
    expect(descreverVagas({ tank: 1, healer: 0, dps: 0 })).toBe('tank');
  });

  it('conta quando falta mais de um da mesma role', () => {
    expect(descreverVagas({ tank: 0, healer: 1, dps: 2 })).toBe('healer + 2 dps');
  });
});

describe('descreverFaixaDeKey', () => {
  it('colapsa faixa de um número só', () => {
    expect(descreverFaixaDeKey(12, 12)).toBe('+12');
    expect(descreverFaixaDeKey(12, 14)).toBe('+12 a +14');
  });

  it('escreve zero como M0, nunca "+0"', () => {
    expect(descreverFaixaDeKey(0, 0)).toBe('M0');
    expect(descreverFaixaDeKey(0, 10)).toBe('M0 a +10');
  });
});
