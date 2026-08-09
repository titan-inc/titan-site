'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '../../../lib/config';

export function LogoutButton() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      // credentials: 'include' é obrigatório: sem isso o cookie não vai e a
      // sessão não é apagada no servidor.
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      router.replace('/');
      router.refresh();
    } finally {
      setSaindo(false);
    }
  }

  return (
    <button
      type="button"
      onClick={sair}
      disabled={saindo}
      className="border-border text-fg-muted hover:text-fg hover:border-fg-subtle rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
    >
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  );
}
