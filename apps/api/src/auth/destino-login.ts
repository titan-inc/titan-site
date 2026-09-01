/**
 * Para onde a pessoa volta depois do login.
 *
 * Mora em arquivo próprio porque é validação de segurança, não formatação: o
 * caminho vem da querystring, ou seja, de quem estiver do outro lado. Redirect
 * controlado por parâmetro sem validação é open redirect — e um phishing que
 * começa no nosso domínio e termina em outro é justamente o que faz alguém
 * digitar a senha da Battle.net sem desconfiar.
 */

/** Onde o login cai quando não há destino guardado. */
export const DESTINO_PADRAO = '/interno';

/**
 * O caminho pretendido, ou `null` se não der para confiar nele.
 *
 * Aceita só o que começa em `/interno`, que é a única área que exige sessão —
 * então é o único lugar de onde alguém é mandado embora e quer voltar.
 *
 * As recusas, e por que cada uma:
 *
 * - `//outro.site` e `/\outro.site` — o browser lê as duas como URL absoluta
 *   com host, então "começa com barra" sozinho NÃO garante que é local;
 * - esquema explícito (`https:`, `javascript:`) — nunca começa com barra, mas
 *   o teste de prefixo abaixo é o que garante;
 * - caractere de controle — partiria o header `Location` em duas linhas;
 * - qualquer coisa fora de `/interno` — não precisa de sessão, não precisa
 *   voltar, e ampliar o alvo é ampliar a superfície de graça.
 *
 * Querystring e fragmento sobrevivem: `/interno/loot/abc?item=3` é link
 * legítimo, do tipo que a Regra 7 manda o Discord postar.
 */
export function destinoSeguro(de: string | undefined): string | null {
  if (!de) return null;

  // Uma barra só, e o caractere seguinte não pode ser separador. Prefixo a
  // prefixo em vez de `new URL()`: é o teste que o browser de fato faz ao
  // resolver um `Location` relativo.
  if (!de.startsWith('/') || de.startsWith('//') || de.startsWith('/\\')) return null;

  // Por código, e não por regex: caractere de controle dentro de literal de
  // regex é invisível na revisão, e o `no-control-regex` do eslint existe
  // exatamente por isso. Aqui o que se recusa está escrito por extenso.
  for (const c of de) {
    const codigo = c.codePointAt(0) ?? 0;
    if (codigo <= 0x1f || codigo === 0x7f) return null;
  }

  if (de !== DESTINO_PADRAO && !de.startsWith(`${DESTINO_PADRAO}/`)) return null;

  return de;
}
