import type { ResumoProgressaoNav } from '../../../lib/progressao/resumo-nav';

export function descricaoProgressao(progressao: ResumoProgressaoNav | null): string {
  return progressao
    ? `Progressão da guilda em ${progressao.raidNome}, dificuldade ${progressao.dificuldadeNome}: ${progressao.vencidos} de ${progressao.total} bosses vencidos.`
    : 'Progressão da guilda indisponível.';
}

function MarcasProgressao({ progressao }: { progressao: ResumoProgressaoNav }) {
  if (progressao.total > 20) return null;
  return (
    <span
      aria-hidden="true"
      className={`border-groove flex h-[14px] items-end border-b ${progressao.total > 12 ? 'gap-0.5' : 'gap-1 xl:gap-[5px]'}`}
    >
      {progressao.estados.map((vencido, indice) => (
        <span
          key={indice}
          className={
            vencido
              ? 'haste-acesa bg-accent h-3 w-0.5 shrink-0 opacity-70'
              : 'bg-pedra-deep h-1.5 w-px shrink-0'
          }
        />
      ))}
    </span>
  );
}

export function ProgressaoNav({
  progressao,
  rolada,
}: {
  progressao: ResumoProgressaoNav | null;
  rolada: boolean;
}) {
  const descricao = descricaoProgressao(progressao);
  // Sulco nos dois lados: a régua é um bloco de leitura, não um item de menu.
  // O sulco de fecho existe porque sem ele a contagem encostava no primeiro
  // link — `ml-auto` no grupo de links não garante folga quando o nome da raid
  // trunca ocupando a largura máxima.
  return (
    <div
      title={progressao ? `${progressao.raidNome} · ${progressao.dificuldadeNome}` : undefined}
      className="mr-6 ml-5 hidden h-11 min-w-0 items-center gap-3 lg:flex xl:mr-8"
    >
      <span
        aria-hidden="true"
        className={`bg-groove h-5 w-px shrink-0 ${rolada ? 'opacity-100' : 'opacity-70'}`}
      />
      <span aria-hidden="true" className="contents">
        {progressao ? (
          <>
            {/* Sigla, não o nome inteiro: "Complexo Meridian · Mítico" truncava
                em "Complexo Merid…", que não informa nada. `CM · M` é como
                jogador escreve progressão, cabe a partir do lg e dispensa o
                truncamento. O nome completo fica no `title`, no painel do
                mobile e na descrição do leitor de tela. */}
            <span className="text-fg-muted shrink-0 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap uppercase">
              {progressao.raidSigla} · {progressao.dificuldadeSigla}
            </span>
            <span className={rolada ? 'opacity-100' : 'opacity-70'}>
              <MarcasProgressao progressao={progressao} />
            </span>
            <span className="text-fg shrink-0 font-mono text-[11px] font-semibold tabular-nums">
              {progressao.vencidos}/{progressao.total}
            </span>
          </>
        ) : (
          <>
            <span className="text-fg-muted shrink-0 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap uppercase">
              Sem leitura
            </span>
            <span className="text-fg shrink-0 font-mono text-[11px] font-semibold tabular-nums">
              —/—
            </span>
          </>
        )}
      </span>
      <span className="sr-only">{descricao}</span>
      <span
        aria-hidden="true"
        className={`bg-groove ml-1 h-5 w-px shrink-0 ${rolada ? 'opacity-100' : 'opacity-70'}`}
      />
    </div>
  );
}

export function ProgressaoPainel({ progressao }: { progressao: ResumoProgressaoNav | null }) {
  return (
    <section aria-label="Progressão da raid" className="border-border mb-1 border-b pb-5">
      <p className="text-fg-subtle font-mono text-[10px] tracking-[0.14em] uppercase">
        Progressão da raid
      </p>
      {progressao ? (
        <>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-fg min-w-0 text-base leading-tight font-semibold">
              {progressao.raidNome} · {progressao.dificuldadeNome}
            </p>
            <p className="text-fg shrink-0 font-mono text-[13px] font-semibold tabular-nums">
              {progressao.vencidos}/{progressao.total}
            </p>
          </div>
          {progressao.total <= 20 && (
            <div className="mt-3 flex max-w-[280px] items-end">
              <MarcasProgressao progressao={progressao} />
            </div>
          )}
          {progressao.desenvolvimento && (
            <p className="text-danger mt-2 font-mono text-[10px] tracking-[0.12em] uppercase">
              Dados de desenvolvimento
            </p>
          )}
        </>
      ) : (
        <p className="text-fg-muted mt-2 text-sm">Progressão indisponível</p>
      )}
    </section>
  );
}
