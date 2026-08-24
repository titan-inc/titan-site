'use client';

import {
  criarVagaSchema,
  MPLUS_BUFFS,
  VAGA_AGENDAMENTO_MAX_DIAS,
  VAGA_EXPURGO_DIAS,
  vagaSchema,
  type MplusBuff,
  type Vaga,
} from '@titan/shared';
import { useMemo, useRef, useState, useTransition } from 'react';
import { API_URL } from '../../../../lib/config';
import { CartaoVaga } from './cartao-vaga';
import { useMontado } from './usar-montado';

const DIA_MS = 24 * 60 * 60 * 1_000;

/** `datetime-local` fala no fuso do navegador; o contrato fala em UTC. */
function paraInputLocal(data: Date): string {
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Amanhã 21h, que é o caso que originou a tela. */
function amanhaANoite(): Date {
  const data = new Date(Date.now() + DIA_MS);
  data.setHours(21, 0, 0, 0);
  return data;
}

/**
 * Campos que têm mensagem de erro própria, colada no input.
 *
 * Qualquer erro fora desta lista cai no bloco geral. É o que impede um campo
 * novo no schema de falhar em silêncio: sem isso, `keyMin` reprovava a
 * validação e o botão parecia morto, porque a mensagem não tinha onde aparecer.
 */
const CAMPOS_INLINE = new Set(['vagas', 'quando', 'keyMin', 'keyMax', 'observacao']);

const VAZIO = {
  tank: false,
  healer: false,
  dps: 0,
  keyMin: 10,
  keyMax: 12,
  faltando: [] as MplusBuff[],
  observacao: '',
};

/**
 * Criar e apagar vaga de M+.
 *
 * Escreve direto na API do Nest (`credentials: 'include'` leva o cookie), não
 * por route handler do Next — Regra 1.
 *
 * A tela só confirma o que o servidor confirmou: nada de atualização otimista,
 * porque "vaga criada" aqui significa "anúncio publicado no Discord", e afirmar
 * isso antes da resposta seria mentir sobre uma mensagem que pode não ter saído.
 */
export function Vagas({ inicial }: { inicial: Vaga[] }) {
  const [vagas, setVagas] = useState(inicial);
  const [form, setForm] = useState(VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pendente, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // O padrão e os limites dependem da hora de AGORA e do fuso do NAVEGADOR — o
  // servidor não sabe nenhum dos dois. Ficam vazios até a hidratação terminar,
  // senão o HTML dos dois lados diverge.
  const montado = useMontado();
  const { padrao, limites } = useMemo(() => {
    if (!montado) return { padrao: '', limites: null };

    const agora = new Date();
    return {
      padrao: paraInputLocal(amanhaANoite()),
      limites: {
        min: paraInputLocal(agora),
        max: paraInputLocal(new Date(agora.getTime() + VAGA_AGENDAMENTO_MAX_DIAS * DIA_MS)),
      },
    };
  }, [montado]);

  // Só vira estado quando a pessoa mexe; antes disso é o padrão derivado acima.
  const [quandoEditado, setQuandoEditado] = useState<string | null>(null);
  const quando = quandoEditado ?? padrao;

  // Erros sem lugar próprio na tela — inclusive o de envio.
  const semLugarInline = Object.entries(erros).filter(([campo]) => !CAMPOS_INLINE.has(campo));

  function alternarBuff(buff: MplusBuff, marcado: boolean) {
    setForm((atual) => ({
      ...atual,
      faltando: marcado ? [...atual.faltando, buff] : atual.faltando.filter((b) => b !== buff),
    }));
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErros({});

    const candidata = {
      vagas: { tank: form.tank ? 1 : 0, healer: form.healer ? 1 : 0, dps: form.dps },
      // Data inválida vira string vazia, que o schema recusa com a mensagem
      // certa em vez de estourar um RangeError.
      quando: quando ? new Date(quando).toISOString() : '',
      keyMin: form.keyMin,
      keyMax: form.keyMax,
      faltando: form.faltando,
      ...(form.observacao.trim() ? { observacao: form.observacao.trim() } : {}),
    };

    const resultado = criarVagaSchema.safeParse(candidata);
    if (!resultado.success) {
      setErros(mapearIssues(resultado.error.issues));
      focarPrimeiroErro(formRef.current);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/internal/mplus/vagas`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resultado.data),
        });

        if (!res.ok) {
          const corpo = (await res.json().catch(() => null)) as {
            message?: unknown;
            issues?: Array<{ path: string; message: string }>;
          } | null;

          if (res.status === 400 && corpo?.issues) {
            setErros(Object.fromEntries(corpo.issues.map((i) => [i.path, i.message])));
            focarPrimeiroErro(formRef.current);
            return;
          }

          // A API manda mensagem pensada para esta tela — inclusive a que diz
          // que a vaga foi salva mas não anunciada.
          throw new Error(
            typeof corpo?.message === 'string' ? corpo.message : `Falhou (HTTP ${res.status})`,
          );
        }

        const criada = vagaSchema.safeParse(await res.json());
        if (!criada.success) throw new Error('Resposta inesperada da API');

        setVagas((atuais) =>
          [...atuais, criada.data].sort((a, b) => a.quando.localeCompare(b.quando)),
        );
        // Valores preservados até aqui: só limpa depois de o Discord aceitar.
        // `quando` fica como está — quem anuncia duas keys costuma marcá-las
        // para a mesma noite.
        setForm(VAZIO);
      } catch (err) {
        setErros({ envio: err instanceof Error ? err.message : 'Não foi possível anunciar.' });
      }
    });
  }

  function apagar(vaga: Vaga) {
    startTransition(async () => {
      setErros({});
      try {
        const res = await fetch(`${API_URL}/internal/mplus/vagas/${vaga.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok && res.status !== 404) throw new Error(`Falhou (HTTP ${res.status})`);

        setVagas((atuais) => atuais.filter((v) => v.id !== vaga.id));
      } catch (err) {
        setErros({ envio: err instanceof Error ? err.message : 'Não foi possível apagar.' });
      }
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-fg text-lg font-semibold tracking-tight">Anunciar uma vaga</h2>
          <p className="text-fg-muted mt-1 text-sm">
            Diz o que falta e quando. O anúncio vai para o canal de M+ no Discord, e quem topar
            responde por lá — ninguém precisa abrir o site para responder.
          </p>
        </div>

        <form ref={formRef} onSubmit={submeter} noValidate className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
              O que falta
            </legend>
            <div className="flex flex-wrap items-center gap-5 pt-1">
              <label className="text-fg-muted flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="tank"
                  checked={form.tank}
                  onChange={(e) => setForm({ ...form, tank: e.target.checked })}
                />
                Tank
              </label>
              <label className="text-fg-muted flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="healer"
                  checked={form.healer}
                  onChange={(e) => setForm({ ...form, healer: e.target.checked })}
                />
                Healer
              </label>
              <label className="text-fg-muted flex items-center gap-2 text-sm" htmlFor="dps">
                DPS
                <select
                  id="dps"
                  name="dps"
                  value={form.dps}
                  onChange={(e) => setForm({ ...form, dps: Number(e.target.value) })}
                  className="border-border bg-bg text-fg rounded-md border px-2 py-1"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {erros.vagas ? <Erro>{erros.vagas}</Erro> : null}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="quando" className="text-fg text-sm font-medium">
              Quando
            </label>
            <input
              id="quando"
              name="quando"
              type="datetime-local"
              value={quando}
              min={limites?.min}
              max={limites?.max}
              onChange={(e) => setQuandoEditado(e.target.value)}
              className="border-border bg-bg text-fg w-fit rounded-md border px-3 py-2 text-sm"
            />
            <p className="text-fg-subtle text-xs">
              No seu fuso. Dá para marcar até {VAGA_AGENDAMENTO_MAX_DIAS} dias à frente.
            </p>
            {erros.quando ? <Erro>{erros.quando}</Erro> : null}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="keyMin" className="text-fg text-sm font-medium">
                Key de
              </label>
              <input
                id="keyMin"
                name="keyMin"
                type="number"
                min={0}
                max={40}
                value={form.keyMin}
                onChange={(e) => setForm({ ...form, keyMin: Number(e.target.value) })}
                className="border-border bg-bg text-fg w-24 rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="keyMax" className="text-fg text-sm font-medium">
                até
              </label>
              <input
                id="keyMax"
                name="keyMax"
                type="number"
                min={0}
                max={40}
                value={form.keyMax}
                onChange={(e) => setForm({ ...form, keyMax: Number(e.target.value) })}
                className="border-border bg-bg text-fg w-24 rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <p className="text-fg-subtle max-w-sm text-xs">
              0 é M0. Depois dela vem a +2 — key +1 não existe. É sinalização, não filtro: o anúncio
              aparece igual para todo mundo, e quem joga key alta costuma topar ajudar numa mais
              baixa.
            </p>
          </div>
          {erros.keyMin ? <Erro>{erros.keyMin}</Erro> : null}
          {erros.keyMax ? <Erro>{erros.keyMax}</Erro> : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
              O grupo não tem
            </legend>
            <div className="flex flex-wrap items-center gap-5 pt-1">
              {MPLUS_BUFFS.map((buff) => (
                <label key={buff} className="text-fg-muted flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={buff}
                    checked={form.faltando.includes(buff)}
                    onChange={(e) => alternarBuff(buff, e.target.checked)}
                  />
                  {buff}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="observacao" className="text-fg text-sm font-medium">
              Observação
            </label>
            <textarea
              id="observacao"
              name="observacao"
              rows={3}
              maxLength={500}
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              className="border-border bg-bg text-fg rounded-md border px-3 py-2 text-sm"
            />
            {erros.observacao ? <Erro>{erros.observacao}</Erro> : null}
          </div>

          {semLugarInline.length > 0 ? (
            <div
              role="alert"
              className="border-border text-fg flex flex-col gap-1 rounded-md border border-dashed p-4 text-sm"
            >
              {semLugarInline.map(([campo, mensagem]) => (
                <p key={campo}>{mensagem}</p>
              ))}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pendente}
            className="bg-accent text-bg hover:bg-accent/90 focus-visible:outline-accent inline-flex min-h-11 w-fit items-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {pendente ? 'Anunciando…' : 'Anunciar no Discord'}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-fg text-lg font-semibold tracking-tight">Vagas abertas</h2>
          <p className="text-fg-muted mt-1 text-sm">
            Somem sozinhas {VAGA_EXPURGO_DIAS} dias depois de criadas.{' '}
            <strong>Apagar tira a vaga do site, e só</strong> — a mensagem já publicada continua no
            canal do Discord, e quem apagar vai continuar recebendo resposta por lá.
          </p>
        </div>

        {vagas.length === 0 ? (
          <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
            Nenhuma vaga aberta agora.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {vagas.map((vaga) => (
              <CartaoVaga key={vaga.id} vaga={vaga} onApagar={apagar} pendente={pendente} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Erro({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-red-400">
      {children}
    </p>
  );
}

/** `path` do zod → nome do campo, do jeito que a tela indexa os erros. */
function mapearIssues(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return Object.fromEntries(
    issues.map((issue) => [String(issue.path[0] ?? 'envio'), issue.message]),
  );
}

function focarPrimeiroErro(form: HTMLFormElement | null) {
  const alvo = form?.querySelector<HTMLElement>('[aria-invalid="true"], input, select, textarea');
  alvo?.focus();
}
