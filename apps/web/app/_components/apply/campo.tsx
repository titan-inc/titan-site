'use client';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
interface CampoProps {
  id: string;
  label: string;
  ajuda?: string;
  erro?: string;
  textarea?: boolean;
  input?: InputHTMLAttributes<HTMLInputElement>;
  area?: TextareaHTMLAttributes<HTMLTextAreaElement>;
}
export function Campo({ id, label, ajuda, erro, textarea, input, area }: CampoProps) {
  const descricao =
    [ajuda ? `${id}-ajuda` : '', erro ? `${id}-erro` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="text-fg-subtle font-mono text-[11px] tracking-[0.14em] uppercase"
      >
        {label}
      </label>
      {textarea ? (
        <textarea
          id={id}
          aria-invalid={Boolean(erro)}
          aria-describedby={descricao}
          className={`text-fg mt-2 min-h-32 w-full resize-y border-0 border-b bg-transparent py-3 outline-none focus:border-b-2 ${erro ? 'border-danger' : 'border-border focus:border-accent'}`}
          {...area}
        />
      ) : (
        <input
          id={id}
          aria-invalid={Boolean(erro)}
          aria-describedby={descricao}
          className={`text-fg mt-2 min-h-11 w-full border-0 border-b bg-transparent py-2 outline-none focus:border-b-2 ${erro ? 'border-danger' : 'border-border focus:border-accent'}`}
          {...input}
        />
      )}{' '}
      {ajuda && (
        <p id={`${id}-ajuda`} className="text-fg-subtle mt-2 text-[13px]">
          {ajuda}
        </p>
      )}
      {erro && (
        <p id={`${id}-erro`} className="text-danger mt-2 text-[13px]">
          {erro}
        </p>
      )}
    </div>
  );
}
