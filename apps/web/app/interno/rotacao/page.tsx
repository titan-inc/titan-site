import { canSeeOthersHistory } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getRotationView, getSessionUser } from '../../../lib/api';
import { Planejador } from './_components/planejador';

export const metadata = { title: 'Rotação — Titan Inc' };

/** "29/09" a partir de "2026-09-29". A string já é a data no fuso da guilda. */
function dataCurta(date: string): string {
  const [, mes, dia] = date.split('-');
  return `${dia}/${mes}`;
}

/**
 * Rotação de banco. **Só oficial**, e isso não é preferência de UI.
 *
 * Quando a liderança diz que alguém vai sentar, é esperado que a pessoa apareça
 * na raid mesmo assim, para o caso de precisar trocar. Saber antes faz a pessoa
 * não aparecer — então o plano não chega a quem vai ser sentado. Ver Regra 7.
 *
 * Quem barra de verdade é o `OfficerGuard` no Nest; isto aqui é UX (Regra 5).
 */
export default async function RotacaoPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!canSeeOthersHistory(user)) redirect('/interno');

  const view = await getRotationView();

  return (
    <main className="flex flex-1 flex-col gap-6">
      <div>
        {/* `pedra-lit` e não `bronze`: aquele token não existe mais no @theme e
            a classe não gera CSS nenhum. As outras telas ainda usam — TIT-153. */}
        <p className="text-pedra-lit font-mono text-xs tracking-widest uppercase">Time de raid</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">
          Rotação
          {view && <span className="text-fg-muted"> — semana de {dataCurta(view.weekStart)}</span>}
        </h1>
        <p className="text-fg-muted mt-2 text-sm">
          Quem descansa nesta semana. O time vem do WoWAudit; a ordem vem de há quanto tempo cada um
          não senta. A sugestão é rascunho — o que vale é o que você salvar.
        </p>
        <p className="text-fg-subtle mt-2 text-sm">
          Não divulgue antes da semana: quem vai para o banco precisa aparecer na raid mesmo assim.
        </p>
      </div>

      {view === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar o time. Isso acontece quando o WoWAudit está fora do ar e não há
          cache — tente de novo em alguns minutos.
        </p>
      ) : (
        <Planejador inicial={view} />
      )}
    </main>
  );
}
