import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../lib/api';
import { API_URL } from '../../lib/config';
import { MENSAGENS_LOGIN } from '../../lib/auth/mensagens';
import { LinkBattleNet } from '../_components/auth/botao-battlenet';

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  // Já logado não precisa ver esta página.
  const user = await getSessionUser();
  if (user) redirect('/interno');

  const { erro } = await searchParams;
  const mensagem = erro ? MENSAGENS_LOGIN[erro] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div>
        {/* Sem a logo raster (§13 etapa 1 do doc 05). O wordmark tipográfico da
            nav já identifica a página; aqui a h1 basta. */}
        <h1 className="text-fg text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em]">
          Área de membros
        </h1>
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
      <LinkBattleNet href={`${API_URL}/auth/battlenet`} className="w-full">
        Acesse com a Battle.net
      </LinkBattleNet>

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
