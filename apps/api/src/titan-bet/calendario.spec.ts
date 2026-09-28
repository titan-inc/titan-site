import { proximaRodada } from './calendario';

/**
 * T-G01 (calendário) — a próxima rodada: cutoff na próxima terça 12:00 no fuso
 * da guilda (D-35), abertura na sexta 00:00 anterior a ele (§9, `bet-abre-rodada`).
 */
const FUSO = 'America/Sao_Paulo';
const brt = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);

describe('proximaRodada', () => {
  it('numa sexta: cutoff na terça seguinte 12:00 BRT, abertura nesta sexta 00:00', () => {
    expect(proximaRodada(brt('2026-09-25', '10:00'), FUSO)).toEqual({
      cutoffAt: brt('2026-09-29', '12:00'),
      opensAt: brt('2026-09-25', '00:00'),
    });
  });

  it('na terça antes do cutoff: é o cutoff do mesmo dia', () => {
    expect(proximaRodada(brt('2026-09-29', '11:59'), FUSO).cutoffAt).toEqual(
      brt('2026-09-29', '12:00'),
    );
  });

  it('na terça no cutoff ou depois: é a terça da semana seguinte', () => {
    expect(proximaRodada(brt('2026-09-29', '12:00'), FUSO)).toEqual({
      cutoffAt: brt('2026-10-06', '12:00'),
      opensAt: brt('2026-10-02', '00:00'),
    });
  });

  it('no domingo: a terça que vem', () => {
    expect(proximaRodada(brt('2026-09-27', '23:30'), FUSO).cutoffAt).toEqual(
      brt('2026-09-29', '12:00'),
    );
  });

  it('o fuso é o da guilda, não o do servidor: 02:00 UTC de quarta ainda é terça em BRT', () => {
    // 2026-09-30T02:00Z = terça 23:00 BRT, depois do cutoff da terça → a próxima.
    expect(proximaRodada(new Date('2026-09-30T02:00:00Z'), FUSO).cutoffAt).toEqual(
      brt('2026-10-06', '12:00'),
    );
  });

  it('funciona em fuso com horário de verão (America/New_York)', () => {
    // Terça 29/09/2026 12:00 em Nova York é EDT (UTC−4).
    expect(proximaRodada(new Date('2026-09-25T12:00:00Z'), 'America/New_York').cutoffAt).toEqual(
      new Date('2026-09-29T16:00:00Z'),
    );
  });
});
