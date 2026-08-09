import Link from 'next/link';
import { Chapa } from '../../_components/ui/chapa';
import { NotificarOAuth } from './notificar';

export default async function OAuthCallback({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; motivo?: string }>;
}) {
  const params = await searchParams;
  const status = params.status === 'ok' ? 'ok' : 'erro';
  return (
    <div className="bg-bg flex min-h-svh items-center justify-center p-6">
      <Chapa className="max-w-md p-8">
        <h1 className="text-fg text-2xl font-bold">
          {status === 'ok' ? 'Login concluído' : 'Login não concluído'}
        </h1>
        <p className="text-fg-muted mt-3">Pode fechar esta janela e voltar para a Titan Inc.</p>
        <div className="mt-6 flex gap-5 text-sm">
          <Link href="/" className="text-accent underline">
            Voltar à landing
          </Link>
          <Link href="/interno" className="text-fg-muted underline">
            Área de membros
          </Link>
        </div>
        <NotificarOAuth status={status} motivo={params.motivo} />
      </Chapa>
    </div>
  );
}
