'use client';
import { createApplicationSchema } from '@titan/shared';
import { useState } from 'react';
import { Acao } from '../ui/acao';
import { Chapa } from '../ui/chapa';
import { Campo } from './campo';
export function ApplyForm() {
  const [erros, setErros] = useState<Record<string, string>>({});
  function dados(form: FormData) {
    return {
      characterRealm: form.get('characterRealm'),
      roleSpec: form.get('roleSpec'),
      contact: form.get('contact'),
      additionalInfo: form.get('additionalInfo') || undefined,
      website: form.get('website') || undefined,
    };
  }
  function mensagem(texto: string) {
    return texto === 'Required' ? 'Este campo é obrigatório.' : texto;
  }
  function validarAoSair(evento: React.FocusEvent<HTMLFormElement>) {
    const nome = (evento.target as unknown as HTMLInputElement | HTMLTextAreaElement).name;
    if (!nome || nome === 'website') return;
    const resultado = createApplicationSchema.safeParse(dados(new FormData(evento.currentTarget)));
    const issue = resultado.success
      ? undefined
      : resultado.error.issues.find((item) => item.path.join('.') === nome);
    setErros((atuais) => {
      const novos = { ...atuais };
      if (issue) novos[nome] = mensagem(issue.message);
      else delete novos[nome];
      return novos;
    });
  }
  function submeter(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    const resultado = createApplicationSchema.safeParse(dados(form));
    if (resultado.success) {
      setErros({
        envio: 'O envio pelo site ainda não está aberto. Seus dados não foram enviados.',
      });
      return;
    }
    const novos: Record<string, string> = {};
    for (const issue of resultado.error.issues)
      novos[issue.path.join('.')] ??= mensagem(issue.message);
    setErros(novos);
    const primeiro = resultado.error.issues[0]?.path.join('.');
    if (primeiro) document.getElementById(primeiro)?.focus();
  }
  return (
    <form noValidate onSubmit={submeter} onBlur={validarAoSair} className="mt-10 space-y-7">
      {Object.keys(erros).length > 0 && (
        <Chapa className="p-5">
          <div role="alert">
            <p className="text-fg font-bold">Revise a entrada</p>
            <ul className="text-danger mt-2 list-inside list-disc text-sm">
              {Object.values(erros).map((erro, i) => (
                <li key={`${erro}-${i}`}>{erro}</li>
              ))}
            </ul>
          </div>
        </Chapa>
      )}
      <Campo
        id="characterRealm"
        label="Nome / realm do personagem"
        ajuda="Ex.: Thrall — Azralon"
        erro={erros.characterRealm}
        input={{
          name: 'characterRealm',
          required: true,
          minLength: 2,
          maxLength: 80,
          autoComplete: 'off',
        }}
      />
      <Campo
        id="roleSpec"
        label="Role / spec"
        ajuda="Ex.: Tank / Protection Warrior"
        erro={erros.roleSpec}
        input={{
          name: 'roleSpec',
          required: true,
          minLength: 2,
          maxLength: 80,
          autoComplete: 'off',
        }}
      />
      <Campo
        id="contact"
        label="Contato (Discord / Battle.net)"
        ajuda="Informe a tag e a plataforma que prefere."
        erro={erros.contact}
        input={{
          name: 'contact',
          required: true,
          minLength: 2,
          maxLength: 100,
          autoComplete: 'off',
        }}
      />
      <Campo
        id="additionalInfo"
        label="Informações adicionais"
        ajuda="Experiência, disponibilidade ou qualquer contexto que ajude a conversa."
        erro={erros.additionalInfo}
        textarea
        area={{ name: 'additionalInfo', maxLength: 2000, rows: 7, autoComplete: 'off' }}
      />
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <Chapa className="p-5">
        <p id="envio-fechado" role="note" className="text-fg-muted text-sm leading-relaxed">
          O envio pelo site ainda não está aberto. O canal de candidatura será informado aqui quando
          estiver disponível.
        </p>
      </Chapa>
      <Acao
        variante="solida"
        type="submit"
        disabled
        aria-describedby="envio-fechado"
        className="w-full md:w-auto"
      >
        Registrar candidatura
      </Acao>
    </form>
  );
}
