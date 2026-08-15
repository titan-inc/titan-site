'use client';

import type {
  AwardEmMassaResultado,
  Candidato,
  ItemDoPainel,
  LootCouncilPanel,
} from '@titan/shared';
import { useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';
import { urlDoIcone } from './icone-do-item';

/**
 * O quadro do conselho: a mesma lista da metade de baixo, com o que decide.
 *
 * **Componente próprio, e não o de membro com flags por dentro.** Renderiza-se
 * um ou outro conforme quem está olhando, e os dois vêm de endpoints diferentes
 * com guards diferentes. Flag de acesso espalhada é a tela prometendo uma
 * organização que o backend não entrega.
 *
 * Conselheiro é candidato também: a linha dele aparece aqui como a de qualquer
 * um, e a resposta dele continua saindo pelo card lá de baixo.
 */
export function QuadroDoConselho({
  painel,
  nomeDosItens,
  podeDecidir,
  aoAgir,
}: {
  painel: LootCouncilPanel;
  nomeDosItens: Map<string, { nome: string; icone: string | null }>;
  /** `deliberando`: é quando o conselho vota e entrega. Ver `podeVotar()`. */
  podeDecidir: boolean;
  aoAgir: () => void;
}) {
  const [abaId, setAbaId] = useState(painel.itens[0]?.itemId ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AwardEmMassaResultado | null>(null);
  const [enviando, startTransition] = useTransition();

  const aba = painel.itens.find((i) => i.itemId === abaId) ?? painel.itens[0] ?? null;
  if (aba === null) return null;

  function agir(caminho: string, corpo: unknown, aoResponder?: (dados: unknown) => void) {
    setErro(null);

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/loot-sessions/${painel.sessionId}${caminho}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(corpo),
        });

        const dados: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error(mensagem(dados) ?? `HTTP ${res.status}`);

        aoResponder?.(dados);
        aoAgir();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível concluir');
      }
    });
  }

  const alvo = (c: Candidato) => ({ characterName: c.name, characterRealm: c.realm });

  return (
    <section className="border-border overflow-hidden rounded-lg border">
      <div className="border-border flex gap-1 overflow-x-auto border-b p-2">
        {painel.itens.map((item, i) => (
          <button
            key={item.itemId}
            type="button"
            onClick={() => setAbaId(item.itemId)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
              item.itemId === aba.itemId
                ? 'bg-fg text-bg font-medium'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {nomeDosItens.get(item.itemId)?.nome ?? `Peça ${i + 1}`}
            {item.award !== null && <span className="ml-1.5 text-emerald-400">✓</span>}
          </button>
        ))}
      </div>

      <CabecalhoDaPeca
        item={aba}
        icone={nomeDosItens.get(aba.itemId)?.icone ?? null}
        nome={nomeDosItens.get(aba.itemId)?.nome ?? null}
      />

      <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        {podeDecidir ? (
          <>
            <button
              type="button"
              onClick={() => agir('/award-por-maioria', {}, (d) => setResultado(resultadoDe(d)))}
              disabled={enviando}
              className="border-border hover:border-fg-subtle text-fg rounded-md border px-3 py-1.5 text-xs disabled:opacity-60"
            >
              Entregar tudo por votos
            </button>

            <span className="text-fg-subtle text-xs">
              Sem voto não sai peça, e empate volta para a mão — o roll não desempata.
            </span>
          </>
        ) : (
          // Nada de botão morto: a API recusa votar e entregar fora de
          // `deliberando`, e um botão que existe para dar erro é pior que um
          // botão ausente.
          <span className="text-fg-subtle text-xs">
            A votação e as entregas abrem quando você fechar as respostas.
          </span>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="text-fg-subtle border-border border-b text-left text-xs">
          <tr>
            <th className="px-4 py-2 font-medium">Personagem</th>
            <th className="px-4 py-2 font-medium">Resposta</th>
            <th className="px-4 py-2 font-medium">Roll</th>
            <th className="px-4 py-2 font-medium">Votos</th>
            <th className="px-4 py-2 font-medium">Levou antes</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>

        <tbody>
          {aba.candidatos.map((c) => (
            <tr key={`${c.nameKey}|${c.realmKey}`} className="border-border border-b last:border-0">
              <td className="text-fg px-4 py-2">
                {c.name}
                {c.aguardandoNovaResposta && (
                  <span className="block text-xs text-amber-400">aguardando nova resposta</span>
                )}
              </td>

              <td className="px-4 py-2">
                {c.responseOptionSlug === null ? (
                  <span className="text-fg-subtle">{c.respondeu ? 'respondeu' : '—'}</span>
                ) : (
                  <span className="text-fg">{c.responseOptionSlug}</span>
                )}
                {c.note !== null && <span className="text-fg-muted block text-xs">{c.note}</span>}
              </td>

              <td className="text-fg-muted px-4 py-2">{c.roll ?? '—'}</td>

              <td className="text-fg px-4 py-2">{c.votos}</td>

              <td className="text-fg-muted px-4 py-2 text-xs">
                {c.recebidoAntes.length === 0
                  ? 'nada'
                  : c.recebidoAntes.map((r) => r.itemName ?? '?').join(', ')}
              </td>

              <td className="px-4 py-2">
                <AcoesDoCandidato
                  candidato={c}
                  podeDecidir={podeDecidir}
                  entregue={aba.award !== null}
                  ocupado={enviando}
                  aoVotar={() => agir(`/itens/${aba.itemId}/voto`, alvo(c))}
                  aoAwardar={() => agir(`/itens/${aba.itemId}/award`, alvo(c))}
                  aoReabrir={() => agir(`/itens/${aba.itemId}/reabrir`, alvo(c))}
                  aoPassar={(razao) =>
                    agir(`/itens/${aba.itemId}/pass-item-to`, {
                      ...alvo(c),
                      responseOptionSlug: razao,
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aba.candidatos.length === 0 && (
        <p className="text-fg-muted px-4 py-3 text-sm">Ninguém está na sessão ainda.</p>
      )}

      {erro !== null && <p className="px-4 py-2 text-sm text-red-400">{erro}</p>}

      {resultado !== null && <ResultadoEmMassa resultado={resultado} />}
    </section>
  );
}

/** A peça e quem levou, quando alguém levou. */
function CabecalhoDaPeca({
  item,
  icone,
  nome,
}: {
  item: ItemDoPainel;
  icone: string | null;
  nome: string | null;
}) {
  return (
    <div className="border-border flex items-center gap-3 border-b px-4 py-3">
      {icone !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urlDoIcone(icone)} alt="" width={28} height={28} className="rounded" />
      )}

      <div>
        <p className="text-fg text-sm font-medium">{nome ?? 'Peça'}</p>

        {item.award === null ? (
          <p className="text-fg-subtle text-xs">ainda sem dono</p>
        ) : (
          <p className="text-xs text-emerald-400">
            {item.award.winnerName} levou como {item.award.responseOptionSlug}, com{' '}
            {item.award.votes} voto(s) — por {item.award.awardedByBattletag}
            {item.award.note !== null && (
              <span className="text-fg-muted"> · {item.award.note}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * As três formas de finalizar, mais as correções.
 *
 * `award` só aparece para quem declarou alguma coisa: entregar a quem não pediu
 * inverteria o que a sessão registra, e a API recusa. `pass item to` é o
 * caminho para quem não pediu — inclusive para a peça que ninguém quis.
 */
function AcoesDoCandidato({
  candidato,
  podeDecidir,
  entregue,
  ocupado,
  aoVotar,
  aoAwardar,
  aoReabrir,
  aoPassar,
}: {
  candidato: Candidato;
  podeDecidir: boolean;
  entregue: boolean;
  ocupado: boolean;
  aoVotar: () => void;
  aoAwardar: () => void;
  aoReabrir: () => void;
  aoPassar: (razao: string) => void;
}) {
  const [passando, setPassando] = useState(false);

  if (entregue || !podeDecidir) return <span className="text-fg-subtle text-xs">—</span>;

  const declarou = candidato.responseOptionSlug !== null && candidato.responseOptionSlug !== 'noop';

  if (passando) {
    return (
      <span className="flex flex-wrap gap-1">
        {['banking', 'disenchant', 'no_interest'].map((razao) => (
          <button
            key={razao}
            type="button"
            onClick={() => aoPassar(razao)}
            disabled={ocupado}
            className="border-border text-fg rounded border px-2 py-1 text-xs disabled:opacity-60"
          >
            {razao}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPassando(false)}
          className="text-fg-muted px-1 text-xs"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {declarou && (
        <>
          <button
            type="button"
            onClick={aoVotar}
            disabled={ocupado}
            className={`rounded border px-2 py-1 disabled:opacity-60 ${
              candidato.meuVoto ? 'border-fg bg-fg text-bg' : 'border-border text-fg'
            }`}
          >
            {candidato.meuVoto ? 'votado' : 'votar'}
          </button>

          <button
            type="button"
            onClick={aoAwardar}
            disabled={ocupado}
            className="border-border text-fg rounded border px-2 py-1 disabled:opacity-60"
          >
            entregar
          </button>

          <button
            type="button"
            onClick={aoReabrir}
            disabled={ocupado}
            className="text-fg-muted hover:text-fg underline"
          >
            reabrir
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => setPassando(true)}
        disabled={ocupado}
        className="text-fg-muted hover:text-fg underline disabled:opacity-60"
      >
        passar peça
      </button>
    </span>
  );
}

/**
 * O que a entrega em massa fez, peça por peça.
 *
 * Os pulos vêm com o motivo, e não só o total: entregar 3 de 7 sem dizer o que
 * houve com as outras 4 faria o loot master descobrir na hora de encerrar.
 */
function ResultadoEmMassa({ resultado }: { resultado: AwardEmMassaResultado }) {
  return (
    <div className="border-border border-t px-4 py-3 text-xs">
      <p className="text-fg">
        {resultado.entregues === 1 ? '1 peça entregue' : `${resultado.entregues} peças entregues`}
      </p>

      {resultado.pulados.length > 0 && (
        <ul className="text-fg-muted mt-1">
          {resultado.pulados.map((p) => (
            <li key={p.itemId}>· {p.motivo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function resultadoDe(dados: unknown): AwardEmMassaResultado | null {
  if (typeof dados !== 'object' || dados === null) return null;

  const resultado = (dados as { resultado?: unknown }).resultado;
  return typeof resultado === 'object' && resultado !== null
    ? (resultado as AwardEmMassaResultado)
    : null;
}

function mensagem(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null;

  const message = (corpo as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}
