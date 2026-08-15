import { describe, expect, it } from 'vitest';
import {
  LOOT_SESSION_STATUS,
  podeEditarItens,
  respostaLivre,
  sessaoAceitaResposta,
  podeTransicionar,
  podeVotar,
  proximosEstados,
  rollSchema,
  type LootSessionStatus,
} from './loot-session.js';

const TODOS = Object.values(LOOT_SESSION_STATUS);

describe('ciclo de vida da sessão', () => {
  it('o caminho normal vai do rascunho ao encerramento', () => {
    expect(podeTransicionar('rascunho', 'aberta')).toBe(true);
    expect(podeTransicionar('aberta', 'deliberando')).toBe(true);
    expect(podeTransicionar('deliberando', 'encerrada')).toBe(true);
  });

  it('o conselho pode reabrir as respostas', () => {
    // Correção humana, que a Regra 7 manda permitir: sem isso, uma pessoa que
    // esqueceu de responder obrigaria a refazer a sessão inteira.
    expect(podeTransicionar('deliberando', 'aberta')).toBe(true);
  });

  it('de encerrada não se sai', () => {
    // Dali saiu histórico. Reabrir seria reescrever passado — sessão encerrada
    // por engano se conserta na linha de loot, não ressuscitando a sessão.
    expect(proximosEstados('encerrada')).toEqual([]);

    for (const destino of TODOS) {
      expect(podeTransicionar('encerrada', destino)).toBe(false);
    }
  });

  it('não dá para pular etapa', () => {
    expect(podeTransicionar('rascunho', 'deliberando')).toBe(false);
    expect(podeTransicionar('rascunho', 'encerrada')).toBe(false);
    expect(podeTransicionar('aberta', 'encerrada')).toBe(false);
  });

  it('não dá para voltar para rascunho', () => {
    // A lista de itens é o que foi anunciado. Voltar ao rascunho deixaria
    // acrescentar item depois de as pessoas já terem respondido.
    for (const de of TODOS) {
      expect(podeTransicionar(de, 'rascunho')).toBe(false);
    }
  });

  it('estado para ele mesmo não é transição', () => {
    for (const estado of TODOS) {
      expect(podeTransicionar(estado, estado)).toBe(false);
    }
  });
});

describe('o que cada estado permite', () => {
  const permissoes: Array<[LootSessionStatus, boolean, boolean, boolean]> = [
    // estado          editar itens  responder  votar
    ['rascunho', true, false, false],
    ['aberta', false, true, false],
    ['deliberando', false, true, true],
    ['encerrada', false, false, false],
  ];

  it.each(permissoes)('%s', (estado, itens, responder, votar) => {
    expect(podeEditarItens(estado)).toBe(itens);
    expect(sessaoAceitaResposta(estado)).toBe(responder);
    expect(podeVotar(estado)).toBe(votar);
  });

  it('a lista de itens congela quando a sessão abre', () => {
    // O erro que isto tranca: acrescentar item depois de anunciado muda o que
    // as pessoas responderam sem elas saberem.
    expect(podeEditarItens('rascunho')).toBe(true);
    expect(podeEditarItens('aberta')).toBe(false);
  });

  it('votar não vale antes de as respostas fecharem', () => {
    // Seria votar com informação incompleta.
    expect(podeVotar('aberta')).toBe(false);
  });

  describe('aceitar resposta e a resposta ser LIVRE são coisas diferentes', () => {
    it('em deliberando a sessão ainda aceita, mas a resposta não é livre', () => {
      // A sessão aceita porque é lá que o conselho reabre para alguém. QUEM pode
      // responder naquele momento depende do estado da resposta no banco, e essa
      // parte vive no serviço.
      //
      // A primeira versão tinha só a primeira função, o comentário prometia o
      // gate por pessoa, e o serviço não checava nada: qualquer um seguia
      // trocando a resposta durante a deliberação, sem erro nenhum.
      expect(sessaoAceitaResposta('deliberando')).toBe(true);
      expect(respostaLivre('deliberando')).toBe(false);
    });

    it('em aberta as duas valem — é a fase do roll', () => {
      expect(sessaoAceitaResposta('aberta')).toBe(true);
      expect(respostaLivre('aberta')).toBe(true);
    });

    it('fora dessas duas, nada', () => {
      for (const estado of ['rascunho', 'encerrada'] as const) {
        expect(sessaoAceitaResposta(estado)).toBe(false);
        expect(respostaLivre(estado)).toBe(false);
      }
    });
  });
});

describe('roll', () => {
  it('aceita de 1 a 100', () => {
    expect(rollSchema.safeParse(1).success).toBe(true);
    expect(rollSchema.safeParse(100).success).toBe(true);
  });

  it('recusa fora da faixa e quebrado', () => {
    expect(rollSchema.safeParse(0).success).toBe(false);
    expect(rollSchema.safeParse(101).success).toBe(false);
    expect(rollSchema.safeParse(50.5).success).toBe(false);
  });
});
