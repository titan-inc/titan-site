import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'titan_session';

/**
 * Protege /interno/* redirecionando quem não tem cookie de sessão.
 *
 * ISTO É UX, NÃO SEGURANÇA — ver Regra 5 do CLAUDE.md.
 *
 * Este proxy só olha a *presença* do cookie; não valida nada. Um cookie
 * inventado passa por aqui. A segurança real é o MemberGuard no Nest, que
 * resolve a sessão no banco e confere membership em todo endpoint.
 *
 * O papel deste código é só evitar que a pessoa veja uma tela vazia antes de
 * ser mandada para o login.
 *
 * Chamava-se `middleware` até o Next 16, que renomeou a convenção para `proxy`
 * justamente para desencorajar usá-la como camada de autorização. A própria
 * doc do Next diz que proxy "should not be used as a full session management
 * or authorization solution" — mesma regra, agora dita pelo nome do arquivo.
 */
export function proxy(request: NextRequest) {
  const temCookie = request.cookies.has(SESSION_COOKIE);

  if (!temCookie) {
    // Para a home, não para uma página de login: a home é o único lugar de
    // login desde que `/entrar` saiu. O motivo abre o modal e some da URL.
    const url = request.nextUrl.clone();
    const de = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = '/';

    // O caminho pretendido viaja junto (TIT-148). A Regra 7 manda todo post no
    // Discord linkar fundo, na página exata — então o link que a pessoa clica
    // sem sessão é justamente o que ela quer de volta, e devolvê-la em
    // `/interno` genérico faz o link do Discord parecer quebrado.
    //
    // Quem valida isto é `destinoSeguro()` no Nest, nas duas pontas do OAuth.
    // Aqui só se repassa; o Nest é que decide se aceita.
    url.search = `?erro=sessao&de=${encodeURIComponent(de)}`;

    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/interno', '/interno/:path*'],
};
