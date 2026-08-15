import Link from 'next/link';
import { getLootSession, getSessionUser } from '../../../../../lib/api';
import { RotuloDeStatus } from '../../_components/rotulo-de-status';
import { SessaoAoVivo } from '../../_components/sessao-ao-vivo';

export const metadata = { title: 'Sessão de loot — Titan Inc' };

/**
 * Uma sessão de loot, do ponto de vista de quem abriu a página.
 *
 * URL própria de propósito: é o link que vai para o Discord apontando na página
 * exata (Regra 7). "Abre o site e procura" é o que faz ninguém abrir.
 *
 * O que aparece **depende da fase**, e quem decide é a API (TIT-131): na fase de
 * roll cada um vê a própria resposta; quando ela fecha, todo mundo vê tudo. A
 * tela renderiza o que chegou — se filtrasse, o conteúdo estaria a um F12 de
 * distância de qualquer pessoa da raid.
 */
export default async function SessaoDeLootPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sessao, usuario] = await Promise.all([getLootSession(id), getSessionUser()]);

  if (sessao === null) {
    return (
      <div className="flex flex-col gap-4">
        <Voltar />
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Esta sessão não existe, ou não foi possível carregá-la agora.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Voltar />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-fg text-xl font-semibold">{sessao.encounter.name}</h1>
          <p className="text-fg-muted text-xs">
            {sessao.encounter.raid}
            {sessao.difficulty === null ? '' : ` · ${sessao.difficulty}`} · loot master{' '}
            {sessao.createdByBattletag}
          </p>
        </div>

        <RotuloDeStatus status={sessao.status} />
      </header>

      <SessaoAoVivo sessao={sessao} personagens={usuario?.characters ?? []} />
    </div>
  );
}

function Voltar() {
  return (
    <Link href="/interno/loot" className="text-fg-muted hover:text-fg w-fit text-xs">
      ← Sessões
    </Link>
  );
}
