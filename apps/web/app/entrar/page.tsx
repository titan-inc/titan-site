import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../lib/api';
import { API_URL } from '../../lib/config';

const MENSAGENS: Record<string, string> = {
  cancelado: 'Você cancelou a autorização na Blizzard. Nada foi salvo.',
  state:
    'O retorno da Blizzard não pôde ser validado. Isso costuma acontecer quando o login demora demais ou é aberto em outra aba. Tente novamente.',
  // Não chute a causa aqui. Esta mensagem já apontou "redirect URI" para um
  // erro que era violação de constraint no banco, e mandou o dev investigar o
  // portal da Blizzard por meia hora. O detalhe real está no log do servidor.
  falha:
    'Não foi possível concluir o login. Tente de novo; se persistir, avise um oficial — o erro fica registrado no servidor.',
};

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  // Já logado não precisa ver esta página.
  const user = await getSessionUser();
  if (user) redirect('/interno');

  const { erro } = await searchParams;
  const mensagem = erro ? MENSAGENS[erro] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div>
        {/* Sem a logo raster (§13 etapa 1 do doc 05). O wordmark tipográfico da
            nav já identifica a página; aqui a h1 basta. */}
        <h1 className="text-fg text-3xl font-semibold tracking-tight">Área de membros</h1>
        <p className="text-fg-muted mt-3">
          Entre com sua conta Battle.net. Verificamos automaticamente se você tem personagem no
          roster da guilda.
        </p>
      </div>

      {mensagem && (
        <div
          role="alert"
          className="border-danger-soft bg-danger-soft text-fg rounded-lg border px-4 py-3 text-sm"
        >
          {mensagem}
        </div>
      )}

      {/* Link, não fetch: o fluxo OAuth exige navegação de verdade do browser
          para o domínio da Blizzard. */}
      <a
        href={`${API_URL}/auth/battlenet`}
        className="bg-accent text-bg hover:bg-accent/90 flex items-center justify-center gap-2 rounded-lg px-5 py-3 font-medium transition-colors"
      >
        Entrar com Battle.net
      </a>

      <p className="text-fg-subtle text-sm">
        Não é da guilda?{' '}
        <Link href="/" className="text-accent underline">
          Veja como se candidatar
        </Link>
        .
      </p>
    </main>
  );
}
