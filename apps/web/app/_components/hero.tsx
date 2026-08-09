import Image from 'next/image';
import { Acao } from './ui/acao';
import { Rotulo } from './ui/rotulo';

export async function Hero() {
  return (
    <section
      id="topo"
      aria-labelledby="hero-titulo"
      className="border-border bg-deep relative isolate min-h-[calc(100svh-3.5rem)] overflow-hidden border-b lg:max-h-[900px] lg:min-h-[calc(100svh-4rem)]"
    >
      <Image
        fill
        preload
        src="/assets/hero-background.png"
        alt=""
        sizes="100vw"
        className="pointer-events-none object-cover object-[72%_50%] lg:object-[65%_50%]"
      />
      <div
        aria-hidden="true"
        className="from-bg via-bg/90 pointer-events-none absolute inset-0 bg-gradient-to-r via-[48%] to-transparent lg:via-[42%]"
      />
      <div
        aria-hidden="true"
        className="from-bg/35 pointer-events-none absolute inset-0 bg-gradient-to-t via-transparent to-black/20"
      />
      <div className="relative mx-auto grid w-full max-w-[1440px] px-5 pt-16 pb-10 md:px-8 md:pt-20 lg:max-h-[900px] lg:min-h-[calc(100svh-4rem)] lg:grid-cols-12 lg:items-center xl:px-12">
        <div className="relative z-10 lg:col-span-5 lg:col-start-1">
          {/* A logo raster saiu do projeto e não é substituída: a nav já carrega
              o wordmark, e repeti-lo aqui é redundância. O espaço vertical
              liberado vai para o rótulo e a h1, que sobem — não é recuperado
              por padding (§8 do doc 05). */}
          <Rotulo>Titan Inc · Desde 2009</Rotulo>
          <h1
            id="hero-titulo"
            className="text-fg mt-6 text-[clamp(2rem,9vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance md:text-[40px] lg:text-[54px] xl:text-[72px]"
          >
            Endgame sem abrir mão da vida real
          </h1>
          <p className="text-fg-muted mt-6 max-w-[46ch] text-[17px] leading-[1.6] text-pretty">
            Guilda de raid e Mythic+ desde 2009. Cinco horas por semana, para gente com trabalho,
            família e faculdade — e ainda assim progredindo.
          </p>
          <Acao href="#candidatura" variante="solida" className="mt-8 w-full md:w-auto">
            Candidatar-se
          </Acao>
        </div>
        <p className="text-fg-subtle text-[13px] lg:absolute lg:bottom-8 lg:left-12">
          Aferição pública preparada para Warcraft Logs · fonte pendente
        </p>
      </div>
    </section>
  );
}
