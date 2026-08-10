'use client';
import { applyResultSchema, createApplicationSchema } from '@titan/shared';
import { useEffect, useRef, useState, useTransition } from 'react';
import { API_URL } from '../../../lib/config';
import { Acao } from '../ui/acao';
import { Chapa } from '../ui/chapa';
import { Campo } from './campo';
export function ApplyForm() {
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviado, setEnviado] = useState(false);
  const [pendente, startTransition] = useTransition();
  const enviando = useRef(false);
  const confirmacao = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enviado) confirmacao.current?.focus();
  }, [enviado]);
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
  function focarPrimeiro(campo?: string) {
    if (campo) document.getElementById(campo)?.focus();
  }

  function erroDeEnvio(status: number): string {
    if (status === 429) return 'Muitos envios. Tente novamente em alguns minutos.';
    if (status === 502 || status === 503)
      return 'Sua candidatura não chegou. Tente novamente em instantes ou fale com a guilda no Discord.';
    return 'Não foi possível enviar sua candidatura. Seus dados foram preservados; tente novamente.';
  }

  function submeter(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando.current) return;
    const form = new FormData(evento.currentTarget);
    const resultado = createApplicationSchema.safeParse(dados(form));
    if (resultado.success) {
      enviando.current = true;
      setErros({});
      startTransition(async () => {
        try {
          const response = await fetch(`${API_URL}/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resultado.data),
          });

          if (!response.ok) {
            if (response.status === 400) {
              const body: unknown = await response.json().catch(() => null);
              const issues =
                body && typeof body === 'object' && 'issues' in body && Array.isArray(body.issues)
                  ? body.issues
                  : [];
              const novos: Record<string, string> = {};
              for (const issue of issues) {
                if (
                  issue &&
                  typeof issue === 'object' &&
                  'path' in issue &&
                  'message' in issue &&
                  typeof issue.path === 'string'
                ) {
                  novos[issue.path] ??= mensagem(String(issue.message));
                }
              }
              if (Object.keys(novos).length > 0) {
                setErros(novos);
                focarPrimeiro(Object.keys(novos)[0]);
                return;
              }
            }
            setErros({ envio: erroDeEnvio(response.status) });
            return;
          }

          const parsed = applyResultSchema.safeParse(await response.json());
          if (!parsed.success) {
            setErros({ envio: erroDeEnvio(500) });
            return;
          }
          setEnviado(true);
        } catch {
          setErros({ envio: erroDeEnvio(0) });
        } finally {
          enviando.current = false;
        }
      });
      return;
    }
    const novos: Record<string, string> = {};
    for (const issue of resultado.error.issues)
      novos[issue.path.join('.')] ??= mensagem(issue.message);
    setErros(novos);
    focarPrimeiro(resultado.error.issues[0]?.path.join('.'));
  }

  if (enviado) {
    return (
      <Chapa className="mt-10 p-6">
        <div ref={confirmacao} role="status" tabIndex={-1}>
          <p className="text-fg font-bold">Candidatura enviada</p>
          <p className="text-fg-muted mt-2 text-sm leading-relaxed">
            Sua mensagem chegou à equipe de recrutamento. Entraremos em contato pelo canal
            informado.
          </p>
        </div>
      </Chapa>
    );
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
      <Acao
        variante="solida"
        type="submit"
        disabled={pendente}
        aria-disabled={pendente}
        className="w-full md:w-auto"
      >
        {pendente ? 'Enviando…' : 'Registrar candidatura'}
      </Acao>
    </form>
  );
}
