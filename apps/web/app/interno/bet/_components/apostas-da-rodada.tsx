'use client';

import {
  meuSlipSchema,
  salvarSlipSchema,
  submeterSlipSchema,
  type MeuSlip,
  type OddsDaRodada,
  type RodadaDoMembro,
  type SalvarSlip,
} from '@titan/shared';
import { useMemo, useRef, useState, useTransition } from 'react';
import { z } from 'zod';
import { API_URL } from '../../../../lib/config';
import { Acao } from '../../../_components/ui/acao';
import { Quando } from '../../mplus/_components/quando';
import { gold, multiplicador, personagem, STATUS_DO_SLIP, tituloDoMercado } from './rotulos';

const STAKE_PADRAO = '200';

type Mercado = RodadaDoMembro['mercados'][number];

interface Escolha {
  opcao: string | null;
  stake: string;
}

interface Opcao {
  id: string;
  nome: string;
  realm: string | null;
  multiplicador: number | null;
}

/** O rascunho salvo, na forma do form. */
function escolhasDoSlip(slip: MeuSlip | null): Partial<Record<string, Escolha>> {
  if (!slip || slip.status !== 'rascunho') return {};
  return Object.fromEntries(
    slip.apostas.map((a) => [
      a.marketId,
      {
        opcao: 'encounterId' in a ? a.encounterId : a.targetCharacterId,
        stake: String(a.stake),
      },
    ]),
  );
}

/** As apostas de um conjunto de escolhas, na ordem do cardápio — o corpo do Salvar. */
function apostasDasEscolhas(
  cardapio: RodadaDoMembro,
  escolhas: Partial<Record<string, Escolha>>,
): SalvarSlip['apostas'] {
  return cardapio.mercados.flatMap((m): SalvarSlip['apostas'] => {
    const e = escolhas[m.marketId];
    if (!e?.opcao) return [];
    const stake = Number(e.stake);
    return m.kind === 'weekly_progression'
      ? [{ marketId: m.marketId, stake, encounterId: e.opcao }]
      : [{ marketId: m.marketId, stake, targetCharacterId: e.opcao }];
  });
}

/** A mensagem que o Nest mandou, como veio (T-UI04): a API escreve para esta tela. */
async function motivoDaRecusa(res: Response): Promise<string> {
  const corpo = (await res.json().catch(() => null)) as {
    message?: unknown;
    issues?: Array<{ message: string }>;
  } | null;
  if (corpo?.issues?.[0]) return corpo.issues[0].message;
  if (typeof corpo?.message === 'string') return corpo.message;
  return `Falhou (HTTP ${res.status})`;
}

/**
 * A rodada para o membro: mercados, odds e o próprio slip (§34.2, F1).
 *
 * Escreve direto no Nest (`credentials: 'include'`), nunca por route handler do
 * Next — Regra 1. O form valida com os schemas do shared antes de enviar
 * (Regra 2), e o backend continua sendo quem decide: toda recusa dele aparece
 * com a mensagem dele.
 *
 * As opções de cada mercado vêm das **odds**, que já trazem os candidatos que o
 * backend aceita para cada tipo de mercado — a tela não redeclara a regra de
 * role (D-04). Sem odds, não há opções para oferecer, e a tela diz isso.
 */
export function ApostasDaRodada({
  cardapio,
  odds,
  slip: inicial,
}: {
  cardapio: RodadaDoMembro;
  odds: OddsDaRodada | null;
  slip: MeuSlip | null;
}) {
  const [slip, setSlip] = useState(inicial);
  const [novo, setNovo] = useState(false);
  const [escolhas, setEscolhas] = useState(() => escolhasDoSlip(inicial));
  const [deposito, setDeposito] = useState({ name: '', realm: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  // Uma escrita por vez: o `pendente` só desabilita os botões no render
  // seguinte, e um duplo clique chega antes dele (D-72).
  const ocupado = useRef(false);

  const aberta = cardapio.fase === 'OPEN';
  const podeApostar = aberta && cardapio.podeApostar && odds !== null;
  const emRascunho = slip === null || slip.status === 'rascunho' || novo;
  const editavel = podeApostar && emRascunho;
  const base = `${API_URL}/internal/titan-bet/rodadas/${cardapio.roundId}`;

  const opcoes = useMemo(() => {
    const candidatos = new Map(cardapio.candidatos.map((c) => [c.characterId, c]));
    const bosses = new Map(
      cardapio.bossesDeProgressao.map((b) => [b.roundEncounterId, b.encounterName]),
    );
    const proprios = new Set(cardapio.personagensDoApostador);

    return new Map(
      (odds?.mercados ?? []).map((m) => {
        const kind = cardapio.mercados.find((x) => x.marketId === m.marketId)?.kind;
        const lista: Opcao[] = m.opcoes.flatMap((o): Opcao[] => {
          if ('roundEncounterId' in o) {
            const nome = bosses.get(o.roundEncounterId);
            return nome
              ? [{ id: o.roundEncounterId, nome, realm: null, multiplicador: o.multiplicador }]
              : [];
          }
          // First Death não recebe personagem do próprio apostador (D-56): o
          // backend recusa, e oferecer seria convidar a recusa.
          if (kind === 'first_death' && proprios.has(o.characterId)) return [];
          const c = candidatos.get(o.characterId);
          return c
            ? [{ id: c.characterId, nome: c.name, realm: c.realm, multiplicador: o.multiplicador }]
            : [];
        });
        return [m.marketId, lista];
      }),
    );
  }, [cardapio, odds]);

  const apostaDoSlip = useMemo(
    () =>
      new Map(
        (slip && !novo ? slip.apostas : []).map((a) => [
          a.marketId,
          { opcao: 'encounterId' in a ? a.encounterId : a.targetCharacterId, stake: a.stake },
        ]),
      ),
    [slip, novo],
  );

  function escolher(marketId: string, mudanca: Partial<Escolha>) {
    setEscolhas((atual) => ({
      ...atual,
      [marketId]: { ...(atual[marketId] ?? { opcao: null, stake: STAKE_PADRAO }), ...mudanca },
    }));
  }

  /** Relê o próprio slip, pelo contrato estrito — campo a mais não é renderizado. */
  async function relerSlip(): Promise<MeuSlip | null> {
    const res = await fetch(`${base}/slip`, { credentials: 'include', cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await motivoDaRecusa(res));
    const lido = meuSlipSchema.safeParse(await res.json());
    if (!lido.success) throw new Error('Resposta inesperada da API.');
    return lido.data;
  }

  /** A tela difere do rascunho salvo? Então o que ela mostra ainda não está no servidor. */
  const alteradoDesdeSalvo =
    JSON.stringify(apostasDasEscolhas(cardapio, escolhas)) !==
    JSON.stringify(apostasDasEscolhas(cardapio, escolhasDoSlip(novo ? null : slip)));

  /** O rascunho da tela, pelo contrato — ou a mensagem de por que não passa. */
  function rascunhoDaTela(): { ok: true; dados: SalvarSlip } | { ok: false; motivo: string } {
    const r = salvarSlipSchema.safeParse({ apostas: apostasDasEscolhas(cardapio, escolhas) });
    return r.success
      ? { ok: true, dados: r.data }
      : { ok: false, motivo: mensagemDoContrato(r.error) };
  }

  /** PUT do rascunho e releitura; lança com o motivo do backend. */
  async function gravarRascunho(dados: SalvarSlip): Promise<MeuSlip | null> {
    const res = await fetch(`${base}/slip`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
    if (!res.ok) throw new Error(await motivoDaRecusa(res));
    const atual = await relerSlip();
    setSlip(atual);
    setNovo(false);
    setEscolhas(escolhasDoSlip(atual));
    return atual;
  }

  /** Roda uma escrita, uma por vez; a segunda chamada, com a primeira em curso, é ignorada. */
  function escrever(operacao: () => Promise<void>, falha: string) {
    if (ocupado.current) return;
    ocupado.current = true;
    startTransition(async () => {
      try {
        await operacao();
      } catch (err) {
        setErro(err instanceof Error ? err.message : falha);
      } finally {
        ocupado.current = false;
      }
    });
  }

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (ocupado.current) return;
    setErro(null);
    setAviso(null);

    const rascunho = rascunhoDaTela();
    if (!rascunho.ok) return setErro(rascunho.motivo);

    escrever(async () => {
      await gravarRascunho(rascunho.dados);
      setAviso('Rascunho salvo. Ele só vale depois de submeter e o depósito ser confirmado.');
    }, 'Não foi possível salvar.');
  }

  /**
   * Submeter congela o que a tela mostra (D-72): com alteração pendente, salva
   * primeiro, e só submete se o Salvar deu certo. Nunca otimista — congelar o
   * rascunho antigo seria apostar algo que a pessoa não vê.
   */
  function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    if (ocupado.current) return;
    setErro(null);
    setAviso(null);

    const pedido = submeterSlipSchema.safeParse({
      depositCharacter: { name: deposito.name.trim(), realm: deposito.realm.trim() },
    });
    if (!pedido.success) {
      setErro('Informe o personagem que vai depositar e o realm dele.');
      return;
    }
    const rascunho = alteradoDesdeSalvo ? rascunhoDaTela() : null;
    if (rascunho && !rascunho.ok) return setErro(rascunho.motivo);

    escrever(async () => {
      if (rascunho) await gravarRascunho(rascunho.dados);

      const res = await fetch(`${base}/slip/submeter`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido.data),
      });
      if (!res.ok) throw new Error(await motivoDaRecusa(res));
      const total = z.object({ total: z.number().int() }).safeParse(await res.json());
      if (!total.success) throw new Error('Resposta inesperada da API.');

      setSlip(await relerSlip());
    }, 'Não foi possível submeter.');
  }

  function comecarOutro() {
    setNovo(true);
    setEscolhas({});
    setErro(null);
    setAviso(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <Situacao cardapio={cardapio} />

      {slip && slip.status !== 'rascunho' && !novo && (
        <ResumoDoSlip slip={slip} podeRecomecar={podeApostar} onRecomecar={comecarOutro} />
      )}

      {odds === null ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
          Odds indisponíveis agora. As opções de cada mercado vêm delas; tente de novo em instantes.
        </p>
      ) : (
        <form onSubmit={salvar} noValidate className="flex flex-col gap-6">
          {aberta && (
            <p className="text-fg-subtle text-xs">
              O multiplicador é uma projeção: o retorno por 1 gold se o mercado fechasse agora com
              aquela opção vencendo. Muda a cada aposta confirmada e não é promessa.
            </p>
          )}

          {cardapio.mercados.map((m) => (
            <MercadoDaRodada
              key={m.marketId}
              mercado={m}
              opcoes={opcoes.get(m.marketId) ?? []}
              editavel={editavel}
              escolha={escolhas[m.marketId]}
              doSlip={apostaDoSlip.get(m.marketId)}
              onEscolher={(mudanca) => escolher(m.marketId, mudanca)}
            />
          ))}

          {editavel && (
            <div>
              <Acao variante="solida" type="submit" disabled={pendente}>
                Salvar rascunho
              </Acao>
            </div>
          )}
        </form>
      )}

      {editavel && slip?.status === 'rascunho' && !novo && (
        <form onSubmit={submeter} noValidate className="flex flex-col gap-3">
          <h2 className="text-fg text-lg font-semibold tracking-tight">Submeter pagamento</h2>
          <p className="text-fg-muted text-sm">
            Congela o rascunho. Depois, deposite o total no Guild Bank com o personagem informado —
            um officer confere e confirma.
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="text-fg-muted flex flex-col gap-1 text-sm">
              Personagem que deposita
              <input
                className="border-border bg-surface text-fg rounded-md border px-3 py-2"
                value={deposito.name}
                onChange={(e) => setDeposito((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="text-fg-muted flex flex-col gap-1 text-sm">
              Realm
              <input
                className="border-border bg-surface text-fg rounded-md border px-3 py-2"
                value={deposito.realm}
                onChange={(e) => setDeposito((d) => ({ ...d, realm: e.target.value }))}
              />
            </label>
          </div>
          <div>
            <Acao variante="fantasma" type="submit" disabled={pendente}>
              Submeter pagamento
            </Acao>
          </div>
        </form>
      )}

      {erro && (
        <p role="alert" className="text-sm text-red-400">
          {erro}
        </p>
      )}
      {aviso && <p className="text-fg-muted text-sm">{aviso}</p>}
    </div>
  );
}

function mensagemDoContrato(erro: z.ZodError): string {
  const issue = erro.issues[0];
  if (issue?.path.includes('stake')) return 'O stake de cada aposta vai de 200 a 1.000 gold.';
  return issue?.message ?? 'O rascunho não passou na validação.';
}

function Situacao({ cardapio }: { cardapio: RodadaDoMembro }) {
  if (cardapio.fase !== 'OPEN') {
    return (
      <p className="text-fg-muted text-sm">
        Apostas encerradas em <Quando iso={cardapio.cutoffAt} />.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-fg-muted text-sm">
        Apostas até <Quando iso={cardapio.cutoffAt} />.
      </p>
      {!cardapio.podeApostar && (
        <p className="text-fg-muted text-sm">
          Você não está no snapshot de apostadores desta rodada: dá para acompanhar mercados e odds,
          mas não apostar.
        </p>
      )}
    </div>
  );
}

function ResumoDoSlip({
  slip,
  podeRecomecar,
  onRecomecar,
}: {
  slip: MeuSlip;
  podeRecomecar: boolean;
  onRecomecar: () => void;
}) {
  return (
    <section className="border-border flex flex-col gap-2 rounded-lg border p-5">
      <h2 className="text-fg text-lg font-semibold tracking-tight">
        {STATUS_DO_SLIP[slip.status]}
      </h2>
      {slip.depositCharacter && (
        <p className="text-fg-muted text-sm">
          Depositante: <strong className="text-fg">{personagem(slip.depositCharacter)}</strong>
        </p>
      )}
      {slip.status === 'aguardando_deposito' && slip.expectedTotal !== null && (
        <p className="text-fg text-sm">
          Deposite {gold(slip.expectedTotal)} no Guild Bank. Um officer confere e confirma.
        </p>
      )}
      {slip.status === 'valido' && (
        <p className="text-fg text-sm">Depósito confirmado — o slip está concorrendo.</p>
      )}
      {slip.status === 'expirado' && (
        <p className="text-fg-muted text-sm">
          O cutoff chegou sem o depósito confirmado; o slip foi encerrado.
        </p>
      )}
      {slip.status === 'recusado' && (
        <>
          {slip.rejectionReason && <p className="text-fg text-sm">{slip.rejectionReason}</p>}
          {podeRecomecar && (
            <div>
              <Acao variante="fantasma" onClick={onRecomecar}>
                Começar outro slip
              </Acao>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MercadoDaRodada({
  mercado,
  opcoes,
  editavel,
  escolha,
  doSlip,
  onEscolher,
}: {
  mercado: Mercado;
  opcoes: Opcao[];
  editavel: boolean;
  escolha: Escolha | undefined;
  doSlip: { opcao: string; stake: number } | undefined;
  onEscolher: (mudanca: Partial<Escolha>) => void;
}) {
  const titulo = tituloDoMercado(mercado.kind, mercado.boss?.encounterName ?? null);

  return (
    <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <legend className="text-fg px-1 text-sm font-semibold">{titulo}</legend>
      <ul className="flex flex-col gap-1">
        {opcoes.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
            {editavel ? (
              <label className="text-fg flex items-center gap-2">
                <input
                  type="radio"
                  name={mercado.marketId}
                  value={o.id}
                  checked={escolha?.opcao === o.id}
                  onChange={() => onEscolher({ opcao: o.id })}
                />
                <span>{o.nome}</span>
                {o.realm && <span className="text-fg-subtle text-xs">{o.realm}</span>}
                <span className="text-fg-muted font-mono">{multiplicador(o.multiplicador)}</span>
              </label>
            ) : (
              <span className="text-fg flex items-center gap-2">
                <span>{o.nome}</span>
                {o.realm && <span className="text-fg-subtle text-xs">{o.realm}</span>}
                <span className="text-fg-muted font-mono">{multiplicador(o.multiplicador)}</span>
                {doSlip?.opcao === o.id && (
                  <span className="text-bronze text-xs">sua aposta · {gold(doSlip.stake)}</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {editavel && (
        <label className="text-fg-muted flex w-40 flex-col gap-1 text-xs">
          Stake (gold)
          <input
            type="number"
            min={200}
            max={1000}
            step={1}
            className="border-border bg-surface text-fg rounded-md border px-3 py-2 text-sm"
            value={escolha?.stake ?? STAKE_PADRAO}
            onChange={(e) => onEscolher({ stake: e.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
