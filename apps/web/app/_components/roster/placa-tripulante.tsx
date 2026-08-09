import Image from 'next/image';
import type { MembroRoster } from '../../../lib/roster/conteudo';
import { corDaClasse } from '../../../lib/wow/classe';
import { RetratoEditorial } from './retrato-editorial';

export function PlacaTripulante({ membro }: { membro: MembroRoster }) {
  const cor = corDaClasse(membro.classe ?? '') ?? 'var(--color-fg-subtle)';
  return (
    <article
      style={{ borderLeftColor: cor }}
      className="placa-roster chapa bg-surface flex h-[340px] flex-col overflow-hidden border-l-2 transition-[transform,border-width] md:h-[300px] lg:h-[320px] xl:h-[340px]"
    >
      {/* `relative` para a queda do rodapé. Sem ela o retrato termina em aresta
          reta e cada placa vira um quadrado colado na chapa — mesmo problema que
          a arte da hero tinha, mesma solução: a imagem tem que assentar na luz
          em vez de flutuar sobre ela. */}
      <div className="bg-deep relative min-h-0 flex-1 overflow-hidden">
        {membro.imagem && membro.imagemDisponivel ? (
          <>
            <Image
              src={`/roster/${membro.imagem}`}
              alt=""
              width={560}
              height={560}
              loading="lazy"
              sizes="(max-width: 767px) 68vw, (max-width: 1279px) 25vw, 224px"
              className="size-full object-cover object-top"
            />
            <span
              aria-hidden="true"
              className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-linear-to-t to-transparent"
            />
          </>
        ) : (
          <RetratoEditorial
            name={membro.nome}
            realm="Titan Inc"
            cor={cor}
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="border-border border-t px-4 py-4">
        <p title={membro.nome} className="text-fg truncate text-[17px] font-bold">
          {membro.nome}
        </p>
        {/* A classe precisa existir como TEXTO: a cor da borda não pode ser o
            único portador da informação (WCAG 1.4.1), e três das treze cores
            reprovam 4,5:1 e por isso nunca viram texto colorido. Se alguém
            remover esta linha por limpeza visual, a cor de classe sai junto. */}
        {membro.classe && (
          <p className="text-fg-subtle mt-1 truncate font-mono text-[11px] tracking-[0.06em]">
            {membro.classe}
          </p>
        )}
      </div>
    </article>
  );
}
