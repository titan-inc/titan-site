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
  it('quem nunca foi banco é dito como tal, não como zero', () => {
    // "0 semanas sem banco" leria como "acabou de sentar" — o oposto.
    expect(motivoDaSugestao(null)).toBe('ainda não foi banco');
  });

  it('singular e plural', () => {
    expect(motivoDaSugestao(1)).toBe('1 semana sem banco');
    expect(motivoDaSugestao(3)).toBe('3 semanas sem banco');
  });

  it('quem foi banco nesta semana não aparece como candidato', () => {
    expect(motivoDaSugestao(0)).toBe('foi banco esta semana');
  });

  it('nenhum dos textos usa vocabulário de cobrança', () => {
    // A tela fala sobre pessoas que vão ler o que está escrito sobre elas.
    // "nunca sentou" lia como acusação, e foi por isso que caiu.
    const textos = [null, 0, 1, 3].map(motivoDaSugestao);
    expect(textos.some((t) => t.includes('nunca'))).toBe(false);
    expect(textos.every((t) => t.includes('banco'))).toBe(true);
  });
});
