'use client';

import type { SessionUser } from '@titan/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResumoProgressaoNav } from '../../lib/progressao/resumo-nav';
import { LoginButton } from './login-button';
import { descricaoProgressao, ProgressaoNav } from './nav/progressao-nav';
import { NavPainel } from './nav-painel';
import { Wordmark } from './ui/wordmark';

const SECOES = [
  { id: 'sobre', texto: 'Sobre' },
  { id: 'tripulacao', texto: 'Tripulação' },
  { id: 'candidatura', texto: 'Candidatura' },
] as const;

export function SiteNav({
  sessao,
  progressao,
}: {
  sessao: SessionUser | null;
  progressao: ResumoProgressaoNav | null;
}) {
  const [rolada, setRolada] = useState(false);
  const [ativa, setAtiva] = useState('');
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  const fechar = useCallback(() => setAberto(false), []);

  useEffect(() => {
    const rolagem = () => setRolada(window.scrollY >= 24);
    rolagem();
    window.addEventListener('scroll', rolagem, { passive: true });
    return () => window.removeEventListener('scroll', rolagem);
  }, []);

  useEffect(() => {
    const visiveis = new Map<string, number>();
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (entrada.isIntersecting) visiveis.set(entrada.target.id, entrada.intersectionRatio);
          else visiveis.delete(entrada.target.id);
        }
        const escolhida = [...visiveis].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        setAtiva(escolhida);
      },
      { rootMargin: '-64px 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const secao of SECOES) {
      const elemento = document.getElementById(secao.id);
      if (elemento) observador.observe(elemento);
    }
    return () => observador.disconnect();
  }, []);

  const nomeAtivo = SECOES.find((secao) => secao.id === ativa)?.texto ?? 'Seções';
  return (
    <header
      className={`sticky top-0 z-50 transition-colors ${rolada ? 'chapa bg-surface' : 'border-border/40 border-b bg-transparent'}`}
    >
      <nav
        aria-label="Principal"
        className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-5 md:h-[60px] md:px-8 lg:h-16 xl:px-12"
      >
        <noscript>
          <div className="text-fg flex w-full gap-5 overflow-x-auto font-mono text-[11px] uppercase lg:hidden">
            <span className="inline-flex min-h-11 shrink-0 items-center">
              {progressao
                ? `${progressao.raidNome} · ${progressao.dificuldadeNome} · ${progressao.vencidos}/${progressao.total}`
                : 'Progressão indisponível'}
            </span>
            {SECOES.map((secao) => (
              <a key={secao.id} href={`#${secao.id}`} className="inline-flex min-h-11 items-center">
                {secao.texto}
              </a>
            ))}
            {/* Nada de link de login aqui: desde a TIT-148 o `LoginButton` é
                um `<a>`, então ele já sai no HTML e funciona sem JavaScript.
                Este bloco cobre só o que de fato depende de JS — as âncoras de
                seção e a progressão, que a barra normal monta no cliente. */}
          </div>
        </noscript>
        <a
          href="#topo"
          aria-label="Titan Inc — ir para o topo"
          className="text-fg focus-visible:outline-accent inline-flex min-h-11 shrink-0 items-center self-center leading-none focus-visible:outline-2"
        >
          <Wordmark tamanho="mobile" className="lg:text-[22px]" />
        </a>
        <ProgressaoNav progressao={progressao} rolada={rolada} />

        <div className="ml-auto hidden h-full items-center gap-5 lg:flex xl:gap-7">
          {SECOES.map((secao) => {
            const atual = ativa === secao.id;
            return (
              <a
                key={secao.id}
                href={`#${secao.id}`}
                aria-current={atual ? 'page' : undefined}
                className={`focus-visible:outline-accent relative flex h-full items-center font-mono text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 ${atual ? 'text-fg' : 'text-fg-muted'}`}
              >
                {secao.texto}
                <span
                  aria-hidden
                  className={`absolute bottom-0 left-1/2 w-px -translate-x-1/2 transition-all ${atual ? 'bg-accent h-[11px]' : 'bg-border h-[5px]'}`}
                />
              </a>
            );
          })}
          {/* O botão "Candidatar-se" saiu daqui: ele repetia o link "Candidatura"
              que está logo ao lado, apontando para a mesma âncora. A ação primária
              da página continua sendo o CTA da hero. Sem ele a barra respira e o
              único elemento sólido passa a ser o login, que é o que de fato leva
              para outro lugar. */}
          <LoginButton sessao={sessao} />
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          {progressao && (
            <span
              aria-hidden="true"
              className="text-fg hidden max-w-9 font-mono text-[10px] font-semibold tabular-nums min-[390px]:block"
            >
              {progressao.vencidos}/{progressao.total}
            </span>
          )}
          <button
            ref={gatilho}
            type="button"
            aria-expanded={aberto}
            aria-controls="painel-secoes"
            aria-label={`Seções da página: ${nomeAtivo}. ${descricaoProgressao(progressao)}`}
            onClick={() => setAberto((valor) => !valor)}
            className="text-fg focus-visible:outline-accent inline-flex min-h-11 max-w-32 items-center gap-2 px-2 font-mono text-[11px] tracking-[0.14em] uppercase focus-visible:outline-2 max-[340px]:max-w-11"
          >
            <span aria-hidden className="bg-accent h-3 w-px shrink-0" />
            <span className="truncate max-[340px]:sr-only">{nomeAtivo}</span>
            <span aria-hidden>⌄</span>
          </button>
          <LoginButton sessao={sessao} compacto />
        </div>
      </nav>
      <NavPainel aberto={aberto} aoFechar={fechar} gatilho={gatilho} progressao={progressao} />
    </header>
  );
}
