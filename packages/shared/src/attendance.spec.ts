import { describe, expect, it } from 'vitest';
import { isPresent, needsReview, toAttendanceState } from './attendance.js';

describe('toAttendanceState', () => {
  it('noite sem log é "sem-dado", NUNCA falta', () => {
    // Log pode ser enviado dias depois, ou nunca. Virar falta acusaria a raid
    // inteira de furar.
    expect(toAttendanceState('Present', null)).toBe('sem-dado');
    expect(toAttendanceState(null, null)).toBe('sem-dado');
    expect(toAttendanceState('Absent', null)).toBe('sem-dado');
  });

  it('confirmou e raidou é presente', () => {
    expect(toAttendanceState('Present', true)).toBe('presente');
    expect(toAttendanceState('Late', true)).toBe('presente');
  });

  it('raidou sem confirmar', () => {
    expect(toAttendanceState(null, true)).toBe('sem-confirmar');
    expect(toAttendanceState('Unknown', true)).toBe('sem-confirmar');
    expect(toAttendanceState('Absent', true)).toBe('sem-confirmar');
  });

  it('quem estava de banco mas acabou raidando conta como presente', () => {
    // Vale o que aconteceu, não o que estava combinado.
    expect(toAttendanceState('Standby', true)).toBe('presente');
  });

  it('banco declarado no signup não é falta', () => {
    // `Standby` é o banco auto-declarado. Não precisa do RL para esse caso.
    expect(toAttendanceState('Standby', false)).toBe('banco');
  });

  it('quem declinou é ausente, não "não raidou"', () => {
    expect(toAttendanceState('Absent', false)).toBe('ausente');
  });

  it('quem não prometeu nada é rotação, não falta', () => {
    expect(toAttendanceState('Unknown', false)).toBe('rotacao');
    expect(toAttendanceState('Tentative', false)).toBe('rotacao');
    expect(toAttendanceState(null, false)).toBe('rotacao');
  });

  it('confirmou e não apareceu é o ÚNICO estado ambíguo', () => {
    // Banco decidido na hora e furo são indistinguíveis no log, e opostos.
    // Por isso o estado é genérico e o motivo vem do humano.
    expect(toAttendanceState('Present', false)).toBe('nao-raidou');
    expect(toAttendanceState('Late', false)).toBe('nao-raidou');
  });
});

describe('needsReview', () => {
  it('só "nao-raidou" pede anotação do raid leader', () => {
    const pedem = (
      [
        'presente',
        'sem-confirmar',
        'raidou',
        'nao-raidou',
        'banco',
        'ausente',
        'rotacao',
        'sem-dado',
      ] as const
    ).filter(needsReview);

    expect(pedem).toEqual(['nao-raidou']);
  });
});

describe('isPresent', () => {
  it('conta quem esteve na raid, tendo confirmado ou não', () => {
    expect(isPresent('presente')).toBe(true);
    expect(isPresent('sem-confirmar')).toBe(true);
  });

  it('não conta ausência nem falta de dado', () => {
    // "sem-dado" fora da conta é o ponto: noite sem log não pode afundar a
    // taxa de presença de quem estava lá.
    expect(isPresent('sem-dado')).toBe(false);
    expect(isPresent('banco')).toBe(false);
    expect(isPresent('nao-raidou')).toBe(false);
    expect(isPresent('rotacao')).toBe(false);
    expect(isPresent('ausente')).toBe(false);
  });
});

describe('toAttendanceState sem lista de signup', () => {
  it('raidou numa noite sem signups é "raidou", não "sem-confirmar"', () => {
    // As 83 noites de 2024–2025 vêm com a lista vazia do WoWAudit. Dizer
    // "apareceu sem confirmar" ali inventa indisciplina a partir de dado que
    // não existe — e são 2934 registros no backfill.
    expect(toAttendanceState(null, true, false)).toBe('raidou');
  });

  it('continua sendo "sem-confirmar" quando a noite TEM signups', () => {
    expect(toAttendanceState(null, true, true)).toBe('sem-confirmar');
  });

  it('sem signups e sem log continua sendo sem-dado', () => {
    expect(toAttendanceState(null, null, false)).toBe('sem-dado');
    expect(toAttendanceState(null, false, false)).toBe('sem-dado');
  });

  it('"raidou" conta como presença', () => {
    expect(isPresent('raidou')).toBe(true);
  });

  it('"raidou" não pede anotação do raid leader — não há o que corrigir', () => {
    expect(needsReview('raidou')).toBe(false);
  });
});
