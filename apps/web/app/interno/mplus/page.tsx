import { redirect } from 'next/navigation';
import { getSessionUser, getVagas } from '../../../lib/api';
import { Vagas } from './_components/vagas';

export const metadata = { title: 'M+ — Titan Inc' };

/**
 * Vagas de M+.
 *
 * **A única tela interna que não passa pelo corte de rank.** Basta ter
 * personagem no roster: M+ não é raid, e o corte existe para manter a
 * ferramenta do time de raid legível, não para guardar segredo. É a primeira
 * coisa que o estado do meio da Regra 4 — "membro sem acesso" — recebe.
 *
 * Quem barra de verdade é o `RosterGuard` no Nest; isto aqui é UX (Regra 5).
 */
export default async function MplusPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');

  // Sem personagem no roster não é da guilda: a /interno explica esse estado
  // com o texto certo, e não é este o lugar de repetir.
  if (user.membership !== 'member') redirect('/interno');

  const lista = await getVagas();

  return (
    <main className="flex flex-1 flex-col gap-8">
      <div>
        <p className="text-bronze font-mono text-xs tracking-widest uppercase">Mítica+</p>
        <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight">Vagas</h1>
        <p className="text-fg-muted mt-2 max-w-2xl text-sm">
          Montar grupo trava em alinhar agenda, não em achar gente. Aqui você descreve o que o grupo
          já tem e o que falta; o anúncio vai para o canal de M+ no Discord, e a conversa acontece
          lá.
        </p>
      </div>

      {lista === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Não foi possível carregar as vagas agora.
        </p>
      ) : (
        <Vagas inicial={lista.vagas} />
      )}
    </main>
  );
}
