import { VAGA_EXPURGO_DIAS } from '@titan/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, getVaga } from '../../../../lib/api';
import { CartaoVaga } from '../_components/cartao-vaga';

export const metadata = { title: 'Vaga de M+ — Titan Inc' };

/**
 * A página de uma vaga — é ela que o anúncio no Discord linka.
 *
 * Regra 7: todo post linka fundo, na página exata, nunca na home. Sem esta
 * página o link do embed cairia numa lista onde a pessoa teria que reencontrar
 * o anúncio que acabou de ler.
 */
export default async function VagaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (user.membership !== 'member') redirect('/interno');

  const vaga = await getVaga(id);

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Mítica+</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Vaga</h1>
      </div>

      {vaga === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Esta vaga não está mais no site. Vagas somem sozinhas {VAGA_EXPURGO_DIAS} dias depois de
          criadas, e quem criou pode apagar antes disso — a mensagem no Discord continua lá de
          qualquer forma.
        </p>
      ) : (
        <CartaoVaga vaga={vaga} comLink={false} />
      )}

      <Link
        href="/interno/mplus"
        className="border-border text-fg-muted hover:border-fg-subtle hover:text-fg focus-visible:outline-accent inline-flex min-h-11 w-fit items-center rounded-[3px] border px-4 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ← Todas as vagas
      </Link>
    </main>
  );
}
