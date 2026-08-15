import { describe, expect, it } from 'vitest';
import {
  canAccessInternalArea,
  canApply,
  canSeeOthersHistory,
  type SessionUser,
} from './membership.js';

/** O corte real da guilda hoje. Ver GUILD_RANK_ACCESS_MAX. */
const CORTE = 4;

const base: SessionUser = {
  battletag: 'Fulano#1234',
  membership: 'member',
  isOfficer: false,
  guildRank: 4,
  hasInternalAccess: true,
  matchedCharacter: { name: 'Zenithus', realm: 'Azralon', region: 'us' },
  characterCount: 1,
  characters: [{ name: 'Zenithus', realm: 'Azralon', region: 'us' }],
  verifiedAt: '2026-07-30T00:00:00.000Z',
};

const user = (over: Partial<SessionUser> = {}): SessionUser => ({ ...base, ...over });

describe('canAccessInternalArea', () => {
  it('libera quem está exatamente no corte', () => {
    // O corte é inclusivo: rank 4 é Raider, e Raider entra.
    expect(canAccessInternalArea(user({ guildRank: 4 }), CORTE)).toBe(true);
  });

  it('libera rank mais alto na hierarquia (número menor)', () => {
    // Rank 0 é o guild master. Menor número = mais alto.
    expect(canAccessInternalArea(user({ guildRank: 0 }), CORTE)).toBe(true);
  });

  it('bloqueia quem está abaixo do corte', () => {
    // Rank 5 é a maior faixa do roster (123 personagens). Se a comparação
    // estivesse invertida, meia guilda entraria na área interna.
    expect(canAccessInternalArea(user({ guildRank: 5 }), CORTE)).toBe(false);
  });

  it('bloqueia quem não está no roster', () => {
    expect(canAccessInternalArea(user({ membership: 'not-member', guildRank: null }), CORTE)).toBe(
      false,
    );
  });

  it('bloqueia membro sem rank — estado inconsistente nega', () => {
    // No roster mas sem rank não deveria acontecer. Se acontecer, negar é a
    // resposta segura: liberar por engano expõe presença e loot.
    expect(canAccessInternalArea(user({ membership: 'member', guildRank: null }), CORTE)).toBe(
      false,
    );
  });

  it('respeita um corte diferente — o número não está no código', () => {
    expect(canAccessInternalArea(user({ guildRank: 6 }), 6)).toBe(true);
    expect(canAccessInternalArea(user({ guildRank: 6 }), 5)).toBe(false);
  });
});

describe('canApply', () => {
  it('libera quem não está no roster', () => {
    expect(canApply(user({ membership: 'not-member' }))).toBe(true);
  });

  it('NÃO oferece apply para membro fora do corte', () => {
    // O ponto do terceiro estado: um social que está na guilda há dois anos
    // não pode receber a tela de "candidate-se para entrar na guilda".
    expect(canApply(user({ membership: 'member', guildRank: 7 }))).toBe(false);
  });
});

describe('canSeeOthersHistory', () => {
  const base = { hasInternalAccess: true, isOfficer: true };

  it('exige a flag de oficial', () => {
    expect(canSeeOthersHistory(base)).toBe(true);
    expect(canSeeOthersHistory({ ...base, isOfficer: false })).toBe(false);
  });

  it('exige acesso à área interna junto', () => {
    // Sair da guilda derruba o acesso mesmo que ninguém desligue a flag.
    expect(canSeeOthersHistory({ ...base, hasInternalAccess: false })).toBe(false);
  });

  it('membro comum não vê o histórico de outro membro — Regra 7', () => {
    expect(canSeeOthersHistory({ hasInternalAccess: true, isOfficer: false })).toBe(false);
  });
});
