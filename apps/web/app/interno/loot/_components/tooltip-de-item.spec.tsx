// @vitest-environment jsdom

import { ITEM_STATS_INDISPONIVEL, type ComputedItemStats, type ItemView } from '@titan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipDeItem } from './tooltip-de-item';

/** Uma peça completa, sem lacuna — o caminho feliz que cada teste desvia. */
const stats = (over: Partial<ComputedItemStats> = {}): ComputedItemStats => ({
  primario: { valor: 135, tipos: ['strength'] },
  secundarios: [{ nome: 'stamina', valor: 2579 }],
  terciarios: [],
  itemLevel: 298,
  armadura: null,
  block: null,
  dano: null,
  efeito: null,
  set: null,
  vinculo: 'bind_on_pickup',
  flavor: null,
  track: null,
  dificuldade: null,
  sockets: 0,
  desconhecidos: [],
  indisponivel: null,
  ...over,
});

const item = (over: Partial<ItemView> = {}): ItemView => ({
  itemId: 249277,
  itemString: 'item:249277::::::::90:250::6:0:',
  name: "Bellamy's Final Judgement",
  icon: 'inv_sword_1h',
  equipLoc: 'TWOHWEAPON',
  itemSubclass: 'Two-Handed Sword',
  ...stats(),
  ...over,
});

/** Abre o tooltip (hover parado além do atraso de abertura) e devolve o
 * texto do popover, pronto para asserção. */
function abrir(elemento: ItemView, trackScalingIdAtual: number | null = null) {
  vi.useFakeTimers();
  render(
    <TooltipDeItem item={elemento} trackScalingIdAtual={trackScalingIdAtual}>
      <span>gatilho</span>
    </TooltipDeItem>,
  );
  fireEvent.mouseEnter(screen.getByText('gatilho'));
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe('TooltipDeItem', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('regra 1 — indestructible não mostra o número', () => {
    it('indestructible mostra só a palavra, mesmo com valor calculado', () => {
      abrir(item({ terciarios: [{ tipo: 'indestructible', valor: 68 }] }));

      expect(screen.getByText('Indestructible')).toBeTruthy();
      expect(screen.queryByText(/68/)).toBeNull();
    });

    it('os outros três terciários mostram o valor', () => {
      abrir(item({ terciarios: [{ tipo: 'leech', valor: 5000 }] }));

      expect(screen.getByText('+5000 Leech')).toBeTruthy();
    });
  });

  describe('regra 2 — conjunto sem numerador', () => {
    it('mostra o total de peças, nunca a contagem do personagem', () => {
      abrir(
        item({
          set: {
            itemSetId: 1978,
            nome: "Relentless Rider's Lament",
            pecasTotal: 5,
            pecaItemIds: [1, 2, 3, 4, 5],
            bonusPorSpec: [],
          },
        }),
      );

      expect(screen.getByText(/5-Piece Set/)).toBeTruthy();
      // Nunca "4/5" ou qualquer fração — não existe personagem aqui.
      expect(screen.queryByText(/\d\/\d/)).toBeNull();
    });
  });

  describe('regra 3 — a contagem da track depende da season corrente', () => {
    it('scalingId igual ao atual: mostra rank/de', () => {
      abrir(
        item({ track: { nome: 'Myth', rank: 4, de: 6, scalingId: 12 } }),
        12, // trackScalingIdAtual
      );

      expect(screen.getByText('Myth 4/6')).toBeTruthy();
    });

    it('scalingId de season passada: só o nome, sem a contagem', () => {
      // Espécimes do grupo 612 (cinto/anel): scalingId 11, season corrente 12.
      abrir(item({ track: { nome: 'Myth', rank: 4, de: 6, scalingId: 11 } }), 12);

      expect(screen.getByText('Myth')).toBeTruthy();
      expect(screen.queryByText('Myth 4/6')).toBeNull();
    });

    it('sem trackScalingIdAtual (não sabemos qual é a season): nunca chuta a contagem', () => {
      abrir(item({ track: { nome: 'Hero', rank: 1, de: 6, scalingId: 12 } }), null);

      expect(screen.getByText('Hero')).toBeTruthy();
      expect(screen.queryByText('Hero 1/6')).toBeNull();
    });
  });

  describe('regra 4 — primário plural e primário nulo com secundários cheios', () => {
    it('primário flexível mostra os três tipos', () => {
      abrir(item({ primario: { valor: 116, tipos: ['strength', 'agility', 'intellect'] } }));

      expect(screen.getByText('+116 Strength/Agility/Intellect')).toBeTruthy();
    });

    it('Bubblefin Splash Guard: primário nulo não esconde os dois candidatos', () => {
      abrir(
        item({
          primario: null,
          secundarios: [
            { nome: 'strength', valor: 90 },
            { nome: 'intellect', valor: 90 },
          ],
        }),
      );

      expect(screen.getByText('+90 Strength')).toBeTruthy();
      expect(screen.getByText('+90 Intellect')).toBeTruthy();
    });
  });

  describe('regra 5 — vínculo na forma "Binds to…"', () => {
    it('bind_on_pickup', () => {
      abrir(item({ vinculo: 'bind_on_pickup' }));
      expect(screen.getByText('Binds when picked up')).toBeTruthy();
    });

    it('warband (bit 27) é frase diferente de warbound_until_equipped (Type 46)', () => {
      abrir(item({ vinculo: 'warband' }));
      expect(screen.getByText('Binds to Warband')).toBeTruthy();
    });

    it('warbound_until_equipped', () => {
      abrir(item({ vinculo: 'warbound_until_equipped' }));
      expect(screen.getByText('Binds to Warband until equipped')).toBeTruthy();
    });

    it('nulo é lacuna visível, não linha omitida', () => {
      abrir(item({ vinculo: null }));
      expect(screen.getByText('Vínculo desconhecido')).toBeTruthy();
    });
  });

  describe('lacunas — nunca um tooltip com cara de completo faltando metade', () => {
    it('indisponivel presente mostra o motivo, explícito', () => {
      abrir(item({ indisponivel: ITEM_STATS_INDISPONIVEL.SEM_BUILD_ATIVO, itemLevel: null }));

      expect(screen.getByText(/Nenhum pacote de dados do cliente está ativo/)).toBeTruthy();
    });

    it('item fora do catálogo mostra o id no lugar do nome', () => {
      abrir(item({ name: null, icon: null, itemSubclass: null }));

      expect(screen.getByText('Item 249277')).toBeTruthy();
    });

    it('desconhecidos não-vazio aparece explícito', () => {
      abrir(item({ desconhecidos: [6652, 13534] }));

      expect(screen.getByText('2 bônus não reconhecidos')).toBeTruthy();
    });
  });
});
