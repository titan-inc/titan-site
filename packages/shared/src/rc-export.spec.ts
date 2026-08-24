import { describe, expect, it } from 'vitest';
import { rcExportRecordSchema, rcExportSchema, splitNomeRealm } from './rc-export.js';

/**
 * Um registro do jeito que sai do addon: tudo string, menos `itemID` e `votes`.
 *
 * Nomes fictícios — o export real tem gente de verdade e o repo é público.
 */
const registro = (over: Record<string, unknown> = {}) => ({
  id: '1774483920-3',
  player: 'Fulano-Azralon',
  owner: 'Ciclano-Area52',
  itemID: 249308,
  itemString: 'item:249308::::::::90:252::5:4:6652:13577:13334:12794',
  response: 'BiS',
  responseID: '1',
  servertime: '1774483920',
  instance: 'The Voidspire-Heroic',
  boss: 'Fallen-King Salhadaar',
  class: 'MAGE',
  votes: 2,
  gear1: 'item:249100::::::::90:252::5',
  gear2: '',
  note: '',
  ...over,
});

describe('rcExportRecordSchema', () => {
  it('aceita um registro completo', () => {
    expect(rcExportRecordSchema.safeParse(registro()).success).toBe(true);
  });

  it('`servertime` é epoch como TEXTO, não número', () => {
    // Medido: 445 de 445 vêm string. Um schema que exigisse número reprovaria o
    // arquivo inteiro na primeira linha.
    expect(rcExportRecordSchema.safeParse(registro({ servertime: 1774483920 })).success).toBe(
      false,
    );
    expect(rcExportRecordSchema.safeParse(registro({ servertime: 'ontem' })).success).toBe(false);
  });

  describe('rigor onde identifica, tolerância onde é enfeite', () => {
    it('recusa registro sem `id` — sem ele não há idempotência', () => {
      expect(rcExportRecordSchema.safeParse(registro({ id: '' })).success).toBe(false);
      expect(rcExportRecordSchema.safeParse(registro({ id: undefined })).success).toBe(false);
    });

    it('recusa sem quem levou, sem o item e sem a instância', () => {
      expect(rcExportRecordSchema.safeParse(registro({ player: '' })).success).toBe(false);
      expect(rcExportRecordSchema.safeParse(registro({ itemString: '' })).success).toBe(false);
      expect(rcExportRecordSchema.safeParse(registro({ instance: '' })).success).toBe(false);
    });

    it('aceita arquivo sem as colunas decorativas', () => {
      // Arquivo de outra season pode não ter `gear2` ou `note`. Recusar o arquivo
      // inteiro por causa disso perderia histórico que não volta.
      const lido = rcExportRecordSchema.safeParse(
        registro({ class: undefined, gear1: undefined, gear2: undefined, note: undefined }),
      );

      expect(lido.success).toBe(true);
      expect(lido.success && lido.data.gear1).toBe('');
    });
  });

  it('voto ausente é nulo, e voto zero é zero', () => {
    // Zero é resultado: o conselho olhou e ninguém votou. Ausência é fonte que
    // não tem o conceito. Colapsar os dois apagaria a diferença.
    const semCampo = rcExportRecordSchema.safeParse(registro({ votes: undefined }));
    const comZero = rcExportRecordSchema.safeParse(registro({ votes: 0 }));

    expect(semCampo.success && semCampo.data.votes).toBeUndefined();
    expect(comZero.success && comZero.data.votes).toBe(0);
    expect(rcExportRecordSchema.safeParse(registro({ votes: -1 })).success).toBe(false);
  });

  it('descarta os campos que não lemos em vez de reprovar por eles', () => {
    const lido = rcExportRecordSchema.safeParse(
      registro({ date: '2026/03/19', rollType: 'normal', equipLoc: 'INVTYPE_HEAD' }),
    );

    expect(lido.success).toBe(true);
    expect(lido.success && lido.data).not.toHaveProperty('rollType');
  });

  it('o arquivo é uma lista', () => {
    expect(rcExportSchema.safeParse([registro(), registro({ id: '1774483920-4' })]).success).toBe(
      true,
    );
    expect(rcExportSchema.safeParse(registro()).success).toBe(false);
  });
});

describe('splitNomeRealm', () => {
  it('corta no primeiro hífen', () => {
    expect(splitNomeRealm('Fulano-Azralon')).toEqual({ name: 'Fulano', realm: 'Azralon' });
  });

  it('preserva o realm sem separador, do jeito que o cliente escreve', () => {
    // `Area52`, e não `Area 52`: é a grafia do cliente do jogo. Quem normaliza é
    // quem chama, com toRealmMatchKey().
    expect(splitNomeRealm('Fulano-Area52')?.realm).toBe('Area52');
    expect(splitNomeRealm('Fulano-DemonSoul')?.realm).toBe('DemonSoul');
  });

  it('mantém acento no nome — é o que distingue personagens', () => {
    expect(splitNomeRealm('Shrëwd-Azralon')?.name).toBe('Shrëwd');
  });

  it('devolve nulo quando não dá para separar', () => {
    expect(splitNomeRealm('Fulano')).toBeNull();
    expect(splitNomeRealm('-Azralon')).toBeNull();
    expect(splitNomeRealm('Fulano-')).toBeNull();
    expect(splitNomeRealm('')).toBeNull();
  });
});
