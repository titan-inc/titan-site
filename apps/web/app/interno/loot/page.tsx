import { isActingOfficer } from '@titan/shared';
import Link from 'next/link';
import { getLootSessions, getSessionUser } from '../../../lib/api';
import { IniciarSessao } from './_components/iniciar-sessao';
import { RotuloDeStatus } from './_components/rotulo-de-status';

export const metadata = { title: 'Loot — Titan Inc' };

/**
 * Aba da sessão corrente. É a aba inicial de propósito: durante a raid, "o que
 * está rolando agora" é a única pergunta que tem pressa.
 *
 * Lista, e não a sessão direto: duas raids na mesma noite acontecem, e um
 * rascunho convive com a sessão aberta. Cada sessão tem URL própria — é o link
 * que vai para o Discord apontando na página exata, como a Regra 7 pede.
 */
export default async function LootSessaoPage() {
  const [sessoes, usuario] = await Promise.all([getLootSessions(), getSessionUser()]);

  // Esconder é cortesia; quem recusa a criação é o `OfficerGuard` no Nest.
  const podeIniciar = usuario !== null && isActingOfficer(usuario);

  return (
    <div className="flex flex-col gap-5">
      {podeIniciar && <IniciarSessao />}
      {conteudo(sessoes)}
    </div>
  );
}

function conteudo(sessoes: Awaited<ReturnType<typeof getLootSessions>>) {
  if (sessoes === null) {
    return (
      <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
        Não foi possível carregar as sessões agora.
      </p>
    );
  }

  if (sessoes.length === 0) {
    return (
      <div className="border-border rounded-lg border border-dashed p-8 text-center">
        <p className="text-fg-muted text-sm">Nenhuma sessão em andamento.</p>
        <p className="text-fg-subtle mt-1 text-xs">
          Quando o conselho abrir uma, ela aparece aqui — e o link vai para o Discord.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {sessoes.map((sessao) => (
        <li key={sessao.id}>
          <Link
            href={`/interno/loot/sessao/${sessao.id}`}
            className="border-border hover:border-fg-subtle flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors"
          >
            <div>
              <p className="text-fg font-medium">{sessao.encounterName}</p>
              <p className="text-fg-muted text-xs">
                {sessao.raidName}
                {sessao.difficulty === null ? '' : ` · ${sessao.difficulty}`} ·{' '}
                {sessao.itemCount === 1 ? '1 peça' : `${sessao.itemCount} peças`}
              </p>
            </div>

            <RotuloDeStatus status={sessao.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
