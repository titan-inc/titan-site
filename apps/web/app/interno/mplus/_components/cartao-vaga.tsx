'use client';

import { descreverFaixaDeKey, descreverVagas, type Vaga } from '@titan/shared';
import Link from 'next/link';
import { Quando } from './quando';

/**
 * Uma vaga na tela.
 *
 * O botão de apagar só aparece para quem criou, e a API recusa de qualquer
 * forma (Regra 5) — esconder aqui é para não oferecer o que seria negado.
 */
export function CartaoVaga({
  vaga,
  onApagar,
  pendente = false,
  comLink = true,
}: {
  vaga: Vaga;
  onApagar?: (vaga: Vaga) => void;
  pendente?: boolean;
  comLink?: boolean;
}) {
  const titulo = `Falta ${descreverVagas(vaga.vagas)}`;

  return (
    <article className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-fg text-lg font-semibold tracking-tight">
            {comLink ? (
              <Link href={`/interno/mplus/${vaga.id}`} className="hover:text-accent">
                {titulo}
              </Link>
            ) : (
              titulo
            )}
          </h3>
          <p className="text-fg-muted mt-1 text-sm">
            <Quando iso={vaga.quando} /> · {descreverFaixaDeKey(vaga.keyMin, vaga.keyMax)}
          </p>
        </div>

        {onApagar && vaga.podeApagar ? (
          <button
            type="button"
            onClick={() => onApagar(vaga)}
            disabled={pendente}
            className="border-border text-fg-muted hover:border-fg-subtle hover:text-fg focus-visible:outline-accent inline-flex min-h-9 items-center rounded-[3px] border px-3 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            Apagar
          </button>
        ) : null}
      </div>

      <dl className="text-fg-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-fg-subtle">Quem chamou</dt>
          <dd className="font-mono">{vaga.criadaPor}</dd>
        </div>
        {vaga.faltando.length > 0 ? (
          <div className="flex gap-2">
            <dt className="text-fg-subtle">O grupo não tem</dt>
            <dd>{vaga.faltando.join(' + ')}</dd>
          </div>
        ) : null}
      </dl>

      {vaga.observacao ? <p className="text-fg-muted text-sm">{vaga.observacao}</p> : null}

      {!vaga.entregue ? (
        // Lacuna nunca vira silêncio: sem este aviso, quem anunciou fica
        // esperando resposta de uma mensagem que nunca foi publicada.
        <p className="border-border text-fg-muted rounded-md border border-dashed p-3 text-xs">
          Esta vaga <strong>não foi anunciada no Discord</strong> — a entrega falhou. Ela está aqui,
          mas ninguém foi avisado. Apague e crie de novo para tentar outra vez.
        </p>
      ) : null}
    </article>
  );
}
