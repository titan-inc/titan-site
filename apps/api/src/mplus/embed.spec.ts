import type { Vaga } from '@titan/shared';
import { buildVagaEmbed, urlDaVaga } from './embed';

const OPCOES = { webUrl: 'https://titan.example', timezone: 'America/Sao_Paulo' };

const vaga: Vaga = {
  id: 'vaga-1',
  vagas: { tank: 0, healer: 1, dps: 1 },
  quando: '2026-08-13T00:00:00.000Z',
  keyMin: 12,
  keyMax: 14,
  faltando: ['lust'],
  criadaPor: 'Fulano#1234',
  criadaEm: '2026-08-12T15:00:00.000Z',
  entregue: false,
  podeApagar: true,
};

describe('buildVagaEmbed', () => {
  it('põe o essencial no título e linka a página exata da vaga', () => {
    const payload = buildVagaEmbed(vaga, OPCOES);
    const embed = payload.embeds[0]!;

    expect(embed.title).toContain('Falta healer + dps');
    // 00:00Z é 21:00 do dia anterior no fuso da guilda — o título fala a
    // língua de quem joga, o campo abaixo fala a de quem lê.
    expect(embed.title).toContain('21:00');
    expect(embed.url).toBe('https://titan.example/interno/mplus/vaga-1');
  });

  it('manda o horário como timestamp do Discord, que cada um lê no seu fuso', () => {
    const embed = buildVagaEmbed(vaga, OPCOES).embeds[0]!;
    const quando = embed.fields.find((field) => field.name === 'Quando');

    const unix = Math.floor(Date.parse(vaga.quando) / 1_000);
    expect(quando?.value).toBe(`<t:${String(unix)}:F> (<t:${String(unix)}:R>)`);
  });

  it('mostra faixa de key e quem chamou', () => {
    const embed = buildVagaEmbed(vaga, OPCOES).embeds[0]!;

    expect(embed.fields).toContainEqual({ name: 'Key', value: '+12 a +14', inline: true });
    expect(embed.fields).toContainEqual({
      name: 'Quem chamou',
      value: 'Fulano#1234',
      inline: true,
    });
  });

  it('omite o campo de buffs quando o grupo tem tudo', () => {
    const embed = buildVagaEmbed({ ...vaga, faltando: [] }, OPCOES).embeds[0]!;
    expect(embed.fields.some((field) => field.name === 'O grupo não tem')).toBe(false);
  });

  it('não sobrescreve o nome do webhook', () => {
    // Quem decide o nome que aparece no canal é a configuração do webhook no
    // Discord, não o código. Mandar `username` aqui roubaria essa decisão.
    expect(buildVagaEmbed(vaga, OPCOES).username).toBeUndefined();
  });

  it('bloqueia toda menção quando não há cargo configurado', () => {
    const payload = buildVagaEmbed(vaga, OPCOES);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toBeUndefined();
  });

  it('menciona o cargo por whitelist de id, nunca por parse', () => {
    const payload = buildVagaEmbed(vaga, { ...OPCOES, roleId: '123456789012345678' });

    expect(payload.content).toBe('<@&123456789012345678>');
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ['123456789012345678'] });
  });

  it('deixa @everyone, @here e markdown inertes na observação', () => {
    const payload = buildVagaEmbed(
      {
        ...vaga,
        observacao: '@everyone @here **bold** [clique](http://evil.example) `code`',
      },
      OPCOES,
    );

    // A menção só dispara se allowed_mentions permitir — e não permite.
    expect(payload.allowed_mentions.parse).toEqual([]);
    expect(payload.allowed_mentions.roles).toBeUndefined();

    const description = payload.embeds[0]?.description ?? '';
    expect(description).toContain('\\*\\*bold\\*\\*');
    expect(description).toContain('\\[clique\\]');
    expect(description).toContain('\\`code\\`');
  });

  it('omite a descrição quando a observação é vazia ou só espaço', () => {
    expect(buildVagaEmbed({ ...vaga, observacao: '   ' }, OPCOES).embeds[0]?.description).toBe(
      undefined,
    );
    expect(buildVagaEmbed(vaga, OPCOES).embeds[0]?.description).toBeUndefined();
  });

  it('trunca observação longa dentro do limite do Discord', () => {
    const embed = buildVagaEmbed({ ...vaga, observacao: '*'.repeat(3_000) }, OPCOES).embeds[0]!;
    expect(embed.description!.length).toBeLessThanOrEqual(4_000);
    expect(embed.description!.endsWith('…')).toBe(true);
  });
});

describe('urlDaVaga', () => {
  it('não duplica barra quando a base termina em /', () => {
    expect(urlDaVaga('https://titan.example/', 'abc')).toBe(
      'https://titan.example/interno/mplus/abc',
    );
  });
});
