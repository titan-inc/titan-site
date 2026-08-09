import { Rotulo } from './ui/rotulo';

/**
 * `[rótulo, valor, detalhe?]`.
 *
 * O detalhe existe por causa da agenda: dia e horário numa linha só passavam de
 * três linhas na coluna estreita do mobile. Separar mantém o dado completo —
 * início, fim e fuso — sem quebrar a leitura.
 */
const fatos = [
  ['Desde', '2009'],
  ['Ritmo', '5h por semana'],
  ['Agenda', 'Ter · Qui', '21h — 23h30 BRT'],
] as const;

export function Sobre() {
  return (
    <section
      id="sobre"
      aria-labelledby="sobre-titulo"
      className="fratura border-border bg-bg border-b px-6 py-24 md:px-8 md:py-30 lg:py-40 xl:px-12"
    >
      <div className="mx-auto grid max-w-[1120px] gap-12 lg:grid-cols-12 lg:gap-6">
        <dl className="divide-border border-border lg:border-pedra-deep grid grid-cols-3 divide-x border-y py-5 lg:col-span-2 lg:block lg:divide-x-0 lg:border-y-0 lg:border-l lg:py-0 lg:pl-5">
          {fatos.map(([rotulo, valor, detalhe]) => (
            <div
              key={rotulo}
              className="lg:border-border px-3 first:pl-0 lg:border-b lg:px-0 lg:py-6 lg:first:pt-0"
            >
              <dt className="text-fg-subtle font-mono text-[11px] tracking-[0.14em] uppercase">
                {rotulo}
              </dt>
              <dd className="text-fg mt-2 text-[clamp(0.8rem,3.2vw,1.375rem)] leading-tight font-bold lg:text-[22px]">
                {valor}
                {detalhe && (
                  <span className="text-fg-muted mt-1.5 block font-mono text-[11px] font-normal tracking-[0.06em] whitespace-nowrap">
                    {detalhe}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="lg:col-span-6 lg:col-start-4">
          <Rotulo>Sobre</Rotulo>
          <h2
            id="sobre-titulo"
            className="entalhe text-fg mt-6 max-w-[18ch] text-[30px] leading-[1.15] font-extrabold tracking-[-0.02em] text-balance lg:text-[40px]"
          >
            Cinco horas por semana, <span className="letra-fel">desde 2009</span>
          </h2>
          <div className="text-fg-muted mt-8 max-w-[34ch] space-y-6 text-[17px] leading-[1.6] text-pretty md:text-[20px] lg:text-[22px]">
            {/* [LOREM] T9 — trocar quando C1 chegar. */}
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer dignissim, ipsum sed
              fermentum luctus, justo nunc posuere nibh, non placerat erat sapien sit amet massa.
              Vivamus vitae mi at sapien feugiat tincidunt. Curabitur tempus, augue vel commodo
              viverra, justo arcu posuere neque, sed tincidunt turpis arcu eget magna.
            </p>
            <p>
              Praesent non magna at velit sodales aliquet. Donec faucibus, nulla quis volutpat
              consequat, ligula purus faucibus urna, sed luctus lectus ipsum sed justo. Nulla
              facilisi. Proin accumsan, arcu vitae iaculis euismod, sapien neque feugiat nisl, ut
              consequat lorem velit in augue.
            </p>
            <p>
              Aliquam erat volutpat. Suspendisse potenti. Sed euismod sem vitae nisl feugiat, vel
              interdum arcu ullamcorper. Morbi dignissim neque vitae orci tincidunt, et varius metus
              ultrices.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
