import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/api';

/**
 * "Já existe sessão?" — para o botão de login perguntar de dentro do browser.
 *
 * **Único route handler do web, e ele cabe na exceção da Regra 1**: o que faz
 * aqui em vez de no Nest é ler o cookie de sessão, que é justamente uma das
 * três coisas que a regra libera. Não há regra de negócio nenhuma nesta rota —
 * quem decide quem é a pessoa continua sendo `GET /auth/me` do Nest, e este
 * handler só repassa a pergunta com o cookie junto.
 *
 * Existe porque o fim do login por popup não pode depender de `window.opener`
 * (TIT-144). A janela mãe pergunta isto de tempos em tempos e descobre sozinha
 * que a sessão nasceu, mesmo que o popup nunca tenha conseguido avisá-la.
 *
 * Devolve só um booleano de propósito: quem chama quer saber se já pode
 * navegar, e mandar o `SessionUser` inteiro seria expor dado de conta numa
 * rota que o browser chama em laço, sem nenhum uso para ele.
 */
export async function GET() {
  const user = await getSessionUser();

  // `no-store` nos dois níveis: sem isto o Next serviria a primeira resposta
  // ("não logado") pelo resto do polling, e o laço nunca terminaria.
  return NextResponse.json(
    { autenticado: user !== null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const dynamic = 'force-dynamic';
