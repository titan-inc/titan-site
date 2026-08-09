import { describe, expect, it } from 'vitest';
import { isOfficerByGrants } from './officers.js';

/**
 * Nomes fictícios de propósito — CLAUDE.md proíbe nome real de membro no repo.
 * As grafias acentuadas abaixo reproduzem o padrão real: quem chega e encontra
 * o nome ocupado registra uma variação acentuada dele.
 */
const char = (nameKey: string, realmSlug = 'azralon') => ({ nameKey, realmSlug });

describe('isOfficerByGrants', () => {
  it('reconhece a conta quando um personagem dela tem grant', () => {
    expect(isOfficerByGrants([char('fulano')], [char('fulano')])).toBe(true);
  });

  it('nega quando nenhum personagem casa', () => {
    expect(isOfficerByGrants([char('fulano')], [char('sicrano')])).toBe(false);
  });

  it('basta UM personagem com grant, não todos', () => {
    // Agregação por pessoa da Regra 4: a conta é a pessoa, não o personagem.
    const conta = [char('altzinho'), char('mainzao'), char('bankalt')];
    expect(isOfficerByGrants(conta, [char('mainzao')])).toBe(true);
  });

  it('separa personagens de mesmo nome em realms diferentes', () => {
    // Identidade é o par nome + realm, nunca o nome sozinho — Regra 6.
    expect(isOfficerByGrants([char('fulano', 'illidan')], [char('fulano', 'azralon')])).toBe(false);
  });

  it('distingue grafias acentuadas do mesmo nome', () => {
    // Shrëwd e Shrêwd são pessoas diferentes, com ranks diferentes. Se este
    // teste passar a falhar, alguém trocou toCharacterKey por toSlug e o acesso
    // de uma pessoa passou a ser decidido pelo personagem de outra.
    expect(isOfficerByGrants([char('joci')], [char('jocí')])).toBe(false);
    expect(isOfficerByGrants([char('jocí')], [char('jocí')])).toBe(true);
  });

  it('casa apesar de capitalização e forma Unicode diferentes', () => {
    // A Blizzard varia os dois entre endpoints; isso NÃO é distinção de pessoa.
    const nfd = 'jocí'.normalize('NFD');
    expect(isOfficerByGrants([char('Jocí')], [char(nfd)])).toBe(true);
  });

  it('tolera separador de realm escrito de formas diferentes', () => {
    // 58 dos 344 realms US têm hífen no slug, e a Blizzard devolve `area-52`
    // num endpoint e `Area 52` em outro.
    expect(isOfficerByGrants([char('fulano', 'Area 52')], [char('fulano', 'area-52')])).toBe(true);
  });

  it('é falso quando não há grant nenhum', () => {
    // O estado inicial do sistema. Sem isto, um banco vazio poderia virar
    // "todo mundo é oficial" numa refatoração de `every`/`some`.
    expect(isOfficerByGrants([char('fulano')], [])).toBe(false);
  });

  it('é falso para conta sem personagem no roster', () => {
    expect(isOfficerByGrants([], [char('fulano')])).toBe(false);
  });
});
