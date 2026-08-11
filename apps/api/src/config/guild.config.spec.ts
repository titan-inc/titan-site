import { loadGuildConfig } from './guild.config';

const valid = {
  BLIZZARD_REGION: 'us',
  GUILD_NAME: 'Titan Inc',
  GUILD_REALM: 'Azralon',
} satisfies NodeJS.ProcessEnv;

describe('loadGuildConfig', () => {
  it('aceita config válida', () => {
    expect(loadGuildConfig(valid)).toEqual({
      region: 'us',
      name: 'Titan Inc',
      realm: 'Azralon',
      timezone: 'America/Sao_Paulo',
      rankAccessMax: 4,
      officerRankMax: 2,
    });
  });

  describe('GUILD_TIMEZONE', () => {
    it('lê o fuso do ambiente', () => {
      expect(loadGuildConfig({ ...valid, GUILD_TIMEZONE: 'Europe/Lisbon' }).timezone).toBe(
        'Europe/Lisbon',
      );
    });

    it('cai no default quando não está definida', () => {
      expect(loadGuildConfig(valid).timezone).toBe('America/Sao_Paulo');
    });

    it('rejeita fuso inválido no boot', () => {
      // Sem isto, o erro só apareceria dentro do job de presença, como
      // RangeError do Intl, sem mencionar configuração.
      expect(() => loadGuildConfig({ ...valid, GUILD_TIMEZONE: 'Brasilia' })).toThrow(
        /GUILD_TIMEZONE/,
      );
    });
  });

  describe('GUILD_RANK_ACCESS_MAX', () => {
    it('lê o corte do ambiente', () => {
      expect(loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '2' }).rankAccessMax).toBe(2);
    });

    it('cai no default quando não está definida', () => {
      // Um .env de antes da Regra 4 mudar não pode derrubar a API no boot. E o
      // default é o corte real da guilda, então errar aqui restringe, não libera.
      expect(loadGuildConfig(valid).rankAccessMax).toBe(4);
    });

    it('aceita 0 — só o guild master', () => {
      // Guarda contra tratar 0 como "não definido": rank 0 é um corte legítimo.
      expect(loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '0' }).rankAccessMax).toBe(0);
    });

    it('rejeita valor não numérico', () => {
      // Number('raider') é NaN, e toda comparação com NaN é falsa — a área
      // interna ficaria inacessível para todo mundo, sem mensagem de erro.
      expect(() => loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: 'raider' })).toThrow(
        /inválido/,
      );
    });

    it('rejeita negativo e fracionário', () => {
      expect(() => loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '-1' })).toThrow(/inválido/);
      expect(() => loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '4.5' })).toThrow(/inválido/);
    });
  });

  describe('GUILD_OFFICER_RANK_MAX', () => {
    it('lê o corte de oficial do ambiente', () => {
      expect(loadGuildConfig({ ...valid, GUILD_OFFICER_RANK_MAX: '1' }).officerRankMax).toBe(1);
    });

    it('cai no default quando não está definida', () => {
      // Um .env de antes de 10/08/2026 não pode derrubar a API no boot.
      expect(loadGuildConfig(valid).officerRankMax).toBe(2);
    });

    it('aceita 0 — só o guild master', () => {
      expect(loadGuildConfig({ ...valid, GUILD_OFFICER_RANK_MAX: '0' }).officerRankMax).toBe(0);
    });

    it('rejeita valor não numérico, negativo e fracionário', () => {
      const bad = ['oficial', '-1', '1.5'];
      for (const raw of bad) {
        expect(() => loadGuildConfig({ ...valid, GUILD_OFFICER_RANK_MAX: raw })).toThrow(
          /GUILD_OFFICER_RANK_MAX inválido/,
        );
      }
    });

    it('rejeita corte de oficial mais frouxo que o de acesso', () => {
      // Ser oficial exige acesso à área interna (isActingOfficer). Um corte
      // maior marcaria pessoas como oficiais sem nenhuma permissão de oficial —
      // e isso não aparece em tela nenhuma, só na ausência do acesso que a
      // liderança acha que concedeu.
      expect(() =>
        loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '4', GUILD_OFFICER_RANK_MAX: '5' }),
      ).toThrow(/não pode ser maior/);
    });

    it('aceita corte de oficial igual ao de acesso', () => {
      const cfg = loadGuildConfig({
        ...valid,
        GUILD_RANK_ACCESS_MAX: '2',
        GUILD_OFFICER_RANK_MAX: '2',
      });
      expect(cfg.officerRankMax).toBe(2);
    });

    it('o default aperta em silêncio em vez de derrubar o boot', () => {
      // Quem só apertou GUILD_RANK_ACCESS_MAX para 1 não escreveu nada sobre
      // oficiais, e não pode ver a API morrer por um número que não é dele.
      // Apertar restringe — nunca libera.
      expect(loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '1' }).officerRankMax).toBe(1);
      expect(loadGuildConfig({ ...valid, GUILD_RANK_ACCESS_MAX: '0' }).officerRankMax).toBe(0);
    });
  });

  it('assume us quando BLIZZARD_REGION não está definida', () => {
    expect(
      loadGuildConfig({ GUILD_NAME: valid.GUILD_NAME, GUILD_REALM: valid.GUILD_REALM }).region,
    ).toBe('us');
  });

  it('rejeita região que não é us, mesmo sendo válida na Blizzard', () => {
    // A guilda é US-only. Trocar isso no .env sem trocar no código seria um
    // jeito silencioso de esvaziar o roster.
    expect(() => loadGuildConfig({ ...valid, BLIZZARD_REGION: 'eu' })).toThrow(/US-only/);
  });

  it('rejeita região inexistente', () => {
    expect(() => loadGuildConfig({ ...valid, BLIZZARD_REGION: 'br' })).toThrow(/inválida/);
  });

  it('exige GUILD_NAME e GUILD_REALM', () => {
    expect(() => loadGuildConfig({ ...valid, GUILD_NAME: '' })).toThrow(/obrigatórios/);
    expect(() => loadGuildConfig({ ...valid, GUILD_REALM: '   ' })).toThrow(/obrigatórios/);
  });

  it('remove espaços em volta do nome e do realm', () => {
    const cfg = loadGuildConfig({
      ...valid,
      GUILD_NAME: '  Titan Inc  ',
      GUILD_REALM: ' Azralon ',
    });
    expect(cfg).toMatchObject({ name: 'Titan Inc', realm: 'Azralon' });
  });
});
