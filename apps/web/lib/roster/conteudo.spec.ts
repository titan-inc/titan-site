import { describe, expect, it } from 'vitest';
import { corDaClasse } from '../wow/classe';
import { lerConteudoRoster, validarConteudoRoster } from './conteudo';

describe('conteúdo estático do roster', () => {
  it('aceita nome, imagem e classe opcionais', () => {
    expect(
      validarConteudoRoster({
        titulo: 'Time',
        descricao: 'Curadoria',
        membros: [{ nome: 'Kairós' }],
      }),
    ).toEqual({ titulo: 'Time', descricao: 'Curadoria', membros: [{ nome: 'Kairós' }] });
  });

  it('aponta o índice e campo inválidos', () => {
    expect(() =>
      validarConteudoRoster({ titulo: 'Time', descricao: 'Curadoria', membros: [{ nome: '' }] }),
    ).toThrow(/membros|nome/i);
  });

  /**
   * Estes testes valem para **qualquer** `roster.json`, não para a lista de
   * hoje. A versão anterior travava a contagem em dez e quebrou no minuto em
   * que as fotos reais entraram — teste que engessa conteúdo editável vira
   * manutenção, não rede de segurança.
   */
  describe('a lista publicada', () => {
    const conteudo = lerConteudoRoster();

    it('cabe na faixa que a seção sabe diagramar', () => {
      expect(conteudo.membros.length).toBeGreaterThanOrEqual(1);
      expect(conteudo.membros.length).toBeLessThanOrEqual(30);
    });

    // `roster.tsx` usa o nome como `key` do React: repetido, a lista remonta
    // errado e o defeito só aparece na tela.
    it('não repete nome', () => {
      const nomes = conteudo.membros.map((membro) => membro.nome);
      expect(new Set(nomes).size).toBe(nomes.length);
    });

    // Falha aqui = nome de arquivo errado no JSON. Sem este teste a placa cai
    // calada no retrato editorial e ninguém percebe até alguém olhar a página.
    it('tem arquivo para toda imagem declarada', () => {
      for (const membro of conteudo.membros) {
        if (membro.imagem) expect(membro.imagemDisponivel, membro.imagem).toBe(true);
      }
    });

    // Falha aqui = grafia de classe errada; a borda cairia para o cinza neutro.
    it('tem cor para toda classe declarada', () => {
      for (const membro of conteudo.membros) {
        if (membro.classe) expect(corDaClasse(membro.classe), membro.classe).not.toBeNull();
      }
    });
  });
});
