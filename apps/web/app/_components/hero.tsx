import Image from 'next/image';
import { carregarProgressao, creditoAfericao } from '../../lib/progressao/fonte';
import { Acao } from './ui/acao';
import { Rotulo } from './ui/rotulo';

const BRASAS = [
  ['12%', '76%', '22s', '-7s', '9px'],
  ['22%', '88%', '27s', '-15s', '4px'],
  ['34%', '70%', '19s', '-4s', '5px'],
  ['45%', '92%', '30s', '-19s', '4px'],
  ['53%', '80%', '23s', '-11s', '6px'],
  ['61%', '96%', '28s', '-8s', '4px'],
  ['68%', '72%', '21s', '-17s', '5px'],
  ['74%', '87%', '26s', '-3s', '4px'],
  ['79%', '66%', '18s', '-12s', '6px'],
  ['84%', '93%', '29s', '-21s', '4px'],
  ['89%', '78%', '24s', '-6s', '5px'],
  ['93%', '89%', '20s', '-14s', '4px'],
  ['57%', '68%', '25s', '-9s', '4px'],
  ['72%', '98%', '30s', '-24s', '5px'],
] as const;

export async function Hero() {
  const credito = creditoAfericao(await carregarProgressao());
  return (
    <section
      id="topo"
      aria-labelledby="hero-titulo"
      className="fratura hero-campo border-border bg-bg relative isolate min-h-[calc(100svh-3.5rem)] overflow-hidden border-b lg:max-h-[900px] lg:min-h-[calc(100svh-4rem)]"
    >
      <div aria-hidden="true" className="hero-fenda" />
      <div aria-hidden="true" className="campo-estratos" />
      <div aria-hidden="true" className="campo-malha" />
      <div aria-hidden="true" className="veios-fel hero-veios">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div aria-hidden="true" className="brasas">
        {BRASAS.map(([left, top, duration, delay, size], indice) => (
          <span
            key={indice}
            style={{
              left,
              top,
              animationDuration: duration,
              animationDelay: delay,
              width: size,
              height: size,
            }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="hero-scrim" />
      <div aria-hidden="true" className="hero-vinheta" />
      {/* Depois da vinheta de propósito: o horizonte é a fenda no chão, e tanto o
          scrim quanto a vinheta escurecem a base. Pintado antes, ele some. */}
      <div aria-hidden="true" className="hero-horizonte" />
      <div aria-hidden="true" className="hero-horizonte" />

      <div className="relative mx-auto grid w-full max-w-[1440px] px-5 pt-8 pb-10 md:px-8 md:pt-12 lg:max-h-[900px] lg:min-h-[calc(100svh-4rem)] lg:grid-cols-12 lg:items-center lg:pt-16 xl:px-12">
        <div className="relative z-10 row-start-2 lg:col-span-5 lg:col-start-1 lg:row-start-1">
          <Rotulo>Titan Inc · Desde 2009</Rotulo>
          <h1
            id="hero-titulo"
            className="text-fg mt-6 text-[clamp(2rem,9vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance md:text-[40px] lg:text-[54px] xl:text-[72px]"
          >
            Endgame para quem não abre mão da vida real
          </h1>
          <p className="text-fg-muted mt-6 max-w-[46ch] text-[17px] leading-[1.6] text-pretty">
            Cutting Edge Softcore Progression Guild. <br></br>Há mais de uma década reunindo
            jogadores de alta performance com pouco tempo para jogar.
          </p>
          <Acao href="#candidatura" variante="solida" className="mt-8 w-full md:w-auto">
            Candidatar-se
          </Acao>
        </div>
        <div className="hero-arte relative z-[2] row-start-1 mb-4 flex justify-center lg:col-span-6 lg:col-start-7 lg:mb-0">
          <div aria-hidden="true" className="hero-aura" />
          <Image
            src="/assets/curseulatek.webp"
            alt=""
            width={1202}
            height={802}
            preload
            sizes="(max-width: 1023px) 92vw, 46vw"
            className="h-auto w-full max-w-[620px] object-contain"
          />
        </div>
        <p className="text-fg-subtle row-start-3 mt-8 text-[13px] lg:absolute lg:bottom-8 lg:left-12 lg:mt-0">
          {credito}
        </p>
      </div>
    </section>
  );
}
