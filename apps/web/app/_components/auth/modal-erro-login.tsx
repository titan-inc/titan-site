'use client';
import { useEffect, useRef } from 'react';
import { MENSAGENS_LOGIN } from '../../../lib/auth/mensagens';

export function ModalErroLogin({
  motivo,
  aoFechar,
  aoTentar,
}: {
  motivo: string | null;
  aoFechar: () => void;
  aoTentar: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (motivo && !dialog.current?.open) dialog.current?.showModal();
  }, [motivo]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="erro-login-titulo"
      onClose={aoFechar}
      className="chapa bg-surface text-fg m-auto w-[min(92vw,30rem)] p-0 backdrop:bg-[#0e151ab8]"
    >
      <div className="p-6 md:p-8">
        <h2
          id="erro-login-titulo"
          className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em]"
        >
          Login não concluído
        </h2>
        <p className="text-fg-muted mt-4 leading-relaxed">
          {motivo ? (MENSAGENS_LOGIN[motivo] ?? MENSAGENS_LOGIN.falha) : ''}
        </p>
        {motivo === 'bloqueado' && (
          <a href="/entrar" className="text-accent mt-3 inline-block underline">
            Entrar pela página completa
          </a>
        )}
        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="border-border hover:border-pedra min-h-11 rounded-sm border px-5 font-mono text-xs tracking-wider uppercase"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
              aoTentar();
            }}
            className="bg-accent text-bg min-h-11 rounded-sm px-5 font-mono text-xs font-bold tracking-wider uppercase"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    </dialog>
  );
}
