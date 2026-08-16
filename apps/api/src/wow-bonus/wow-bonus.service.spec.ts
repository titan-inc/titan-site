import { BONUS_KINDS, type BonusDictionaryFile } from '@titan/shared';
import type { WowBonusRepository, WowBonusRow } from './wow-bonus.repository';
import { WowBonusService } from './wow-bonus.service';

function linha(over: Partial<WowBonusRow>): WowBonusRow {
  return {
    bonusId: 1,
    kind: 'socket',
    trackName: null,
    trackRank: null,
    trackMaxRank: null,
    itemLevel: null,
    tertiary: null,
    ...over,
  };
}

describe('WowBonusService', () => {
  describe('carregarArquivo', () => {
    it('grava tudo e conta por kind', async () => {
      const upsertMany = jest.fn(() => Promise.resolve());
      const service = new WowBonusService({ upsertMany } as unknown as WowBonusRepository);

      const arquivo: BonusDictionaryFile = {
        version: 1,
        bonuses: [
          { bonusId: 40, kind: BONUS_KINDS.TERTIARY, tertiary: 'avoidance' },
          { bonusId: 41, kind: BONUS_KINDS.TERTIARY, tertiary: 'leech' },
          { bonusId: 13534, kind: BONUS_KINDS.SOCKET },
        ],
      };

      const resultado = await service.carregarArquivo(arquivo);

      expect(upsertMany).toHaveBeenCalledWith(arquivo.bonuses);
      expect(resultado).toEqual({ lidos: 3, porKind: { tertiary: 2, socket: 1 } });
    });
  });

  describe('decodificar', () => {
    it('busca só os ids pedidos e devolve a estrutura decodificada', async () => {
      const findByIds = jest.fn(() =>
        Promise.resolve([
          linha({
            bonusId: 12806,
            kind: 'track',
            trackName: 'Myth',
            trackRank: 4,
            trackMaxRank: 6,
          }),
          linha({ bonusId: 40, kind: 'tertiary', tertiary: 'avoidance' }),
        ]),
      );
      const service = new WowBonusService({ findByIds } as unknown as WowBonusRepository);

      const resultado = await service.decodificar([12806, 40, 9999]);

      expect(findByIds).toHaveBeenCalledWith([12806, 40, 9999]);
      expect(resultado).toEqual({
        itemLevel: null,
        track: { nome: 'Myth', rank: 4, de: 6 },
        sockets: 0,
        terciarios: ['avoidance'],
        desconhecidos: [9999],
      });
    });

    it('itemLevel curado na linha passa para a saída decodificada', async () => {
      const findByIds = jest.fn(() =>
        Promise.resolve([
          linha({
            bonusId: 12806,
            kind: 'track',
            trackName: 'Myth',
            trackRank: 4,
            trackMaxRank: 6,
            itemLevel: 681,
          }),
        ]),
      );
      const service = new WowBonusService({ findByIds } as unknown as WowBonusRepository);

      const resultado = await service.decodificar([12806]);

      expect(resultado.itemLevel).toBe(681);
    });

    it('lista vazia não consulta o banco', async () => {
      const findByIds = jest.fn();
      const service = new WowBonusService({ findByIds } as unknown as WowBonusRepository);

      const resultado = await service.decodificar([]);

      expect(findByIds).not.toHaveBeenCalled();
      expect(resultado).toEqual({
        itemLevel: null,
        track: null,
        sockets: 0,
        terciarios: [],
        desconhecidos: [],
      });
    });

    it('linha kind=track sem trackName é bug de gravação — estoura em vez de adivinhar', async () => {
      const findByIds = jest.fn(() => Promise.resolve([linha({ bonusId: 12806, kind: 'track' })]));
      const service = new WowBonusService({ findByIds } as unknown as WowBonusRepository);

      await expect(service.decodificar([12806])).rejects.toThrow(/kind=track sem/);
    });
  });
});
