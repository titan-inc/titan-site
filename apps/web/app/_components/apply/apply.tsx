import { Rotulo } from '../ui/rotulo';
import { ApplyForm } from './apply-form';
export function Apply() {
  return (
    <section
      id="candidatura"
      aria-labelledby="candidatura-titulo"
      className="recrutamento-fel relative isolate overflow-hidden px-6 py-24 md:px-8 lg:py-32 xl:px-12 xl:py-40"
    >
      <div aria-hidden="true" className="veios-fel">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="relative mx-auto grid max-w-[1120px] lg:grid-cols-12">
        <div className="chapa bg-bg/90 px-5 py-7 shadow-2xl shadow-black/40 md:px-8 md:py-9 lg:col-span-6 lg:col-start-7 lg:justify-self-end xl:max-w-[540px]">
          <Rotulo>Candidatura</Rotulo>
          <h2
            id="candidatura-titulo"
            className="text-fg mt-6 text-[30px] leading-[1.15] font-extrabold text-balance lg:text-[40px]"
          >
            Entrar para o registro
          </h2>
          <p className="text-fg-muted mt-6 text-[17px] leading-[1.6] text-pretty">
            Se o horário bate com o seu, vale conversar. Deixe o essencial; o restante a gente
            resolve em conversa.
          </p>
          <ApplyForm />
        </div>
      </div>
    </section>
  );
}
