import { describe, expect, it } from 'vitest';
import { inicioDaSemana, motivoDaSugestao, semanasEntre } from './rotation.js';

describe('inicioDaSemana', () => {
  it('segunda devolve ela mesma', () => {
    expect(inicioDaSemana('2026-09-28')).toBe('2026-09-28');
  });

  it('terça e quinta da mesma semana caem na mesma segunda', () => {
    // As noites de raid são terça e quinta, e quem descansa descansa a semana
    // inteira — as duas precisam cair no mesmo plano.
    expect(inicioDaSemana('2026-09-29')).toBe('2026-09-28');
    expect(inicioDaSemana('2026-10-01')).toBe('2026-09-28');
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    // O caso que um `% 7` ingênuo erra: getUTCDay() do domingo é 0, e voltar
    // zero dias jogaria o domingo para a semana seguinte.
    expect(inicioDaSemana('2026-10-04')).toBe('2026-09-28');
  });

  it('atravessa a virada de mês e de ano', () => {
    expect(inicioDaSemana('2026-10-02')).toBe('2026-09-28');
    expect(inicioDaSemana('2027-01-01')).toBe('2026-12-28');
  });
});

describe('semanasEntre', () => {
  it('conta semanas de calendário', () => {
    expect(semanasEntre('2026-09-28', '2026-09-28')).toBe(0);
    expect(semanasEntre('2026-09-21', '2026-09-28')).toBe(1);
    expect(semanasEntre('2026-08-31', '2026-09-28')).toBe(4);
  });

  it('não erra na mudança de horário de verão', () => {
    // O arredondamento existe por isso: um fuso que muda no meio do intervalo
    // deixa a diferença em 6,96 ou 7,04 semanas, e truncar daria 6.
    expect(semanasEntre('2026-01-05', '2026-11-09')).toBe(44);
  });
});

describe('motivoDaSugestao', () => {
  it('quem nunca sentou é dito como tal, não como zero', () => {
    // "0 semanas sem sentar" leria como "acabou de sentar" — o oposto.
    expect(motivoDaSugestao(null)).toBe('nunca sentou');
  });

  it('singular e plural', () => {
    expect(motivoDaSugestao(1)).toBe('1 semana sem sentar');
    expect(motivoDaSugestao(3)).toBe('3 semanas sem sentar');
  });

  it('quem sentou nesta semana não aparece como candidato', () => {
    expect(motivoDaSugestao(0)).toBe('sentou esta semana');
  });
});
