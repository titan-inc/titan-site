import { DESTINO_PADRAO, destinoSeguro } from './destino-login';

/**
 * O destino do login vem da querystring, ou seja, de fora. Estes testes são a
 * fronteira: sem eles, `?de=` é open redirect, e um phishing que começa no
 * nosso domínio é o que faz alguém digitar a senha da Battle.net sem
 * desconfiar.
 */
describe('destinoSeguro', () => {
  describe('aceita', () => {
    it.each([
      DESTINO_PADRAO,
      '/interno/loot',
      '/interno/loot/abc123',
      // Link fundo com querystring é o que a Regra 7 manda o Discord postar.
      '/interno/presenca?de=2026-08-01',
      '/interno/mplus#vagas',
    ])('%s', (caminho) => {
      expect(destinoSeguro(caminho)).toBe(caminho);
    });
  });

  describe('recusa', () => {
    // `//host` e `/\host` são o caso que engana: começam com barra, e mesmo
    // assim o browser resolve os dois como URL absoluta com host.
    it.each([
      ['//evil.test/interno', 'duas barras vira host'],
      ['/\\evil.test/interno', 'barra invertida vira host'],
      ['https://evil.test/interno', 'esquema explícito'],
      ['javascript:alert(1)', 'esquema de script'],
      ['interno', 'sem barra é relativo à rota atual'],
      ['/', 'a home não precisa de sessão'],
      ['/interno-outro', 'prefixo parecido não é a área interna'],
      ['/api/internal/ops/qualquer', 'fora da área interna'],
    ])('%s — %s', (caminho) => {
      expect(destinoSeguro(caminho)).toBeNull();
    });

    it('caractere de controle, que partiria o header Location', () => {
      expect(destinoSeguro('/interno\r\nSet-Cookie: a=b')).toBeNull();
      expect(destinoSeguro('/interno\nX: y')).toBeNull();
    });

    it('ausente', () => {
      expect(destinoSeguro(undefined)).toBeNull();
      expect(destinoSeguro('')).toBeNull();
    });
  });
});
