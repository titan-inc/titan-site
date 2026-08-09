'use client';
import { useEffect } from 'react';
export function NotificarOAuth({ status, motivo }: { status: 'ok' | 'erro'; motivo?: string }) {
  useEffect(() => {
    window.opener?.postMessage({ tipo: 'titan-oauth', status, motivo }, window.location.origin);
    if (window.opener) window.close();
  }, [status, motivo]);
  return null;
}
